"""
The collector's service on Fly.io (app `ballest-collector`, tools/fly.toml; ADR 0012, ADR
0014): one always-on process that holds one Steam login (steam_session.py) and runs every
collector job inside itself on it, so no job ever logs another off.

- The Refresh (steampy_collect.refresh) runs at every SLOT_HOURS slot, on the hour in UTC,
  and at once on start when the last slot passed with no Refresh after it (a deploy or a
  crash stopped it; the Refresh is one transaction, so a stopped one wrote nothing).
- The Daily read (daily_watch.Watcher) reads the open Dailies every DAILY_EVERY seconds,
  through file downloads and all (Service.watch_dailies). It skips its turn only while a
  Refresh runs, since the Refresh reads and writes the Dailies itself.
- `POST /add-maps`, from Multiballs when the game Discord's #new-tracks gets a post, adds the
  Workshop's newest Maps (add_maps.add_new), then downloads their files
  (map_files.download_due).
- `POST /refresh` runs a Refresh now, in place of the Actions tab's "Run workflow" button:
  `fly ssh console -a ballest-collector -C "python /app/runner.py ask refresh"`.
- `POST /map-files?budget=SECONDS` downloads every due Map file within the budget, the
  backlog a Refresh's few minutes don't reach, from
  `fly ssh console -a ballest-collector -C "python /app/runner.py ask map-files?budget=3600"`.
  It stops starting downloads BACKLOG_MARGIN before the next slot, so a Refresh never waits
  on it for long.
- `GET /` says what each job last did and whether one is running or waiting
  (`python /app/runner.py status` prints it a line a job).

Every job is a Job: at most one running and one waiting, and a request while one waits
folds into it, as an Actions concurrency group did. The Refresh and both kinds of file
download also take turns (Service.map_file_writers), so two never download one Map's file at
once. Each job's output goes to the log under its name (JobLog), and a job still running after
its time is stopped and counts as failed.

A failed Refresh or Map add posts its last lines to the private ops channel
(OPS_WEBHOOK_URL), in place of Actions' failure emails. A Steam outage, a dropped connection
or a refused login alike, reaches it through the Daily read, once reads have failed for
DAILY_OUTAGE (Steam's short drops pass unremarked); a failed download only logs, since the
next Refresh's Map file step downloads any file still due. The HTTP door listens on Fly's
private network only (no public address), so it takes no secret.

REFRESH_SCHEDULE=off leaves the Refresh to `POST /refresh` and reads no Dailies: for a
first deploy while another Refresh could still start elsewhere, or locally, against a local
database (the jobs write DATABASE_URL, so never with production's in the environment):
  REFRESH_SCHEDULE=off DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev \\
    python tools/runner.py
"""

import asyncio
import collections
import contextlib
import contextvars
import json
import os
import sys
import time
import traceback
import urllib.request
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import add_maps
import campaign_common as cc
import daily_watch
import map_files
import steam_session
import steampy_collect
from aiohttp import web

SLOT_HOURS = 3
# seconds between two Daily reads, counted from each read's start
DAILY_EVERY = 60
# a start this close to the next slot leaves the Refresh to that slot
SLOT_SOON = timedelta(minutes=30)
# seconds a job may run before it is stopped and counts as failed (a Refresh takes 2-6
# minutes, a first one on an empty database ~12)
JOB_TIMEOUT = 60 * 60
# seconds a Daily read may take (one with a lookup at the developers' API takes a few)
DAILY_TIMEOUT = 5 * 60
# seconds Daily reads may keep failing before ops hears: Steam drops logins for a few minutes
# often, and for longer on Tuesdays' maintenance, and the next minute's read rides those out
DAILY_OUTAGE = 30 * 60
# the backlog stops starting downloads this long before the next slot
BACKLOG_MARGIN = timedelta(minutes=15)
# seconds a backlog's last downloads may run past its budget; inside BACKLOG_MARGIN, so the
# slot's Refresh still starts on time
DOWNLOAD_GRACE = 10 * 60
# seconds to keep starting downloads of a new-tracks post's Maps
NEW_MAP_FILES_BUDGET = 120
TAIL_LINES = 15
PORT = int(os.environ.get("PORT", "8080"))


def next_slot(now):
    """The first slot after `now`: the next whole SLOT_HOURS hour in UTC."""
    start = now.replace(minute=0, second=0, microsecond=0)
    return start + timedelta(hours=SLOT_HOURS - start.hour % SLOT_HOURS)


def due_on_start(last_refresh, now):
    """Whether a service starting at `now` runs a Refresh at once: the last slot passed with
    no Refresh after it, and the next one isn't about to come anyway."""
    slot = next_slot(now)
    missed = last_refresh is None or last_refresh < slot - timedelta(hours=SLOT_HOURS)
    return missed and slot - now > SLOT_SOON


class JobLog:
    """This process's stdout and stderr: each line a job prints goes out under the job's
    name (`[refresh] ...`), and its last TAIL_LINES are kept for the job's ops alert. The job
    is the one `job(name)` is open around, in the task or thread that prints (asyncio.to_thread
    carries it along); anything else passes through as it is."""

    _current = contextvars.ContextVar("job")

    def __init__(self, out):
        self.out = out

    @classmethod
    def install(cls):
        """Puts a JobLog over sys.stdout and sys.stderr, once; returns it."""
        if not isinstance(sys.stdout, cls):
            sys.stdout = sys.stderr = cls(sys.stdout)
        return sys.stdout

    @contextlib.contextmanager
    def job(self, name):
        """Tags what is printed inside with `name`; yields the job's last lines."""
        state = {"name": name, "tail": collections.deque(maxlen=TAIL_LINES), "part": ""}
        token = self._current.set(state)
        try:
            yield state["tail"]
        finally:
            if state["part"]:
                self._line(state, state["part"])
            self._current.reset(token)

    def _line(self, state, line):
        state["tail"].append(line)
        self.out.write(f"[{state['name']}] {line}\n")

    def write(self, text):
        state = self._current.get(None)
        if state is None:
            return self.out.write(text)
        *lines, state["part"] = (state["part"] + text).split("\n")
        for line in lines:
            self._line(state, line.rstrip("\r"))
        return len(text)

    def flush(self):
        self.out.flush()

    def __getattr__(self, name):
        return getattr(self.out, name)


class Job:
    """One kind of job: at most one running and one waiting, the waiting one standing for
    every request made while it waits."""

    def __init__(self, work):
        self.work = work
        self.turn = asyncio.Lock()
        self.waiting = False
        self.running = False
        self.last = None
        self.tasks = set()

    def request(self):
        """Queue a run; False when one is already waiting, which this request folds into."""
        if self.waiting:
            return False
        self.waiting = True
        task = asyncio.create_task(self._go())
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return True

    async def _go(self):
        async with self.turn:
            self.waiting, self.running = False, True
            started = datetime.now(UTC)
            try:
                code = await self.work()
            except Exception as e:
                print(f"A job failed: {e!r}", flush=True)
                code = -1
            finally:
                self.running = False
            self.last = {"started": started.isoformat(), "exit": code}

    def status(self):
        return {"running": self.running, "waiting": self.waiting, "last": self.last}


def _tail(lines):
    """A job's last lines as a code block for the ops channel, within Discord's limit."""
    text = "\n".join(lines)[-1500:]
    return f"```\n{text}\n```"


class Service:
    """The jobs and the order they keep. `jobs` runs each one (Collector, or a test's fake):
    `refresh()`, `map_files(maps, budget)` and `read_dailies()` return an exit code, and
    `add_maps()` the pfids it added; `alert(text)` posts to the ops channel."""

    def __init__(self, jobs, alert, now=lambda: datetime.now(UTC)):
        self.jobs, self.alert, self.now = jobs, alert, now
        self.logs = JobLog.install()
        # held by the Refresh and the file downloads, so two never download one Map's file
        self.map_file_writers = asyncio.Lock()
        # held by the Refresh and the Daily read, so one writes the Dailies at a time
        self.daily_writers = asyncio.Lock()
        self.daily_running = False
        self.daily_last = None
        self.new_maps = set()
        self.queue = {
            "refresh": Job(self._refresh),
            "add-maps": Job(self._add_maps),
            "new-map-files": Job(self._new_map_files),
            "map-files": Job(self._map_file_backlog),
        }
        self.backlog_budget = 0

    def refresh(self):
        return self.queue["refresh"].request()

    def add_maps(self):
        return self.queue["add-maps"].request()

    def map_file_backlog(self, budget):
        """Queue the backlog's downloads; a request while one waits sets its budget."""
        self.backlog_budget = budget
        return self.queue["map-files"].request()

    async def _job(self, what, name, work, *, limit=None):
        """`_run`'s exit code, alerting the ops channel with the job's last lines when it
        fails and `what` names it."""
        code, lines = await self._run(name, work, limit=limit)
        if code and what:
            await self.alert(f"Collector: {what} failed (exit {code}).\n{_tail(lines)}")
        return code

    async def _run(self, name, work, *, limit=None):
        """Runs `work()` under the log name `name`, stopped after `limit` seconds (JOB_TIMEOUT
        by default): its exit code, -1 when it raises or is stopped, and its last lines."""
        limit = JOB_TIMEOUT if limit is None else limit
        with self.logs.job(name) as tail:
            stop = asyncio.timeout(limit)
            try:
                async with stop:
                    code = await work()
            except Exception as e:
                stopped = stop.expired()
                # a TimeoutError once stopped is taken for the stop's own, which says no more;
                # anything else does: one before the stop, or what the job raised on its way out
                if not (stopped and isinstance(e, TimeoutError)):
                    traceback.print_exc(file=self.logs)
                if stopped:
                    print(f"(stopped after {limit / 60:g} minutes)")
                code = -1
            return code, list(tail)

    async def _refresh(self):
        async with self.map_file_writers, self.daily_writers:
            return await self._job("Refresh", "refresh", self.jobs.refresh)

    async def _add_maps(self):
        added = []

        async def work():
            added.extend(await self.jobs.add_maps())
            return 0

        code = await self._job("Adding new Maps", "add-maps", work)
        if added:
            self.new_maps.update(added)
            self.queue["new-map-files"].request()
        return code

    async def _new_map_files(self):
        # the Maps are taken once it is this job's turn, so Maps added while it waits come along
        async with self.map_file_writers:
            maps, self.new_maps = sorted(self.new_maps), set()
            return await self._job(
                None,
                "new-map-files",
                lambda: self.jobs.map_files(maps, NEW_MAP_FILES_BUDGET),
                limit=NEW_MAP_FILES_BUDGET + DOWNLOAD_GRACE,
            )

    async def _map_file_backlog(self):
        # stops starting downloads BACKLOG_MARGIN before the next slot, counted once it is
        # this job's turn, so the slot's Refresh isn't kept waiting; the downloads under way
        # finish within DOWNLOAD_GRACE
        async with self.map_file_writers:
            to_slot = (next_slot(self.now()) - self.now() - BACKLOG_MARGIN).total_seconds()
            budget = min(self.backlog_budget, int(to_slot))
            if budget <= 0:
                print("Map file backlog: no time left before the slot; downloading nothing")
                return 0
            return await self._job(
                None,
                "map-files",
                lambda: self.jobs.map_files(None, budget),
                limit=budget + DOWNLOAD_GRACE,
            )

    async def watch_dailies(self, *, sleep=asyncio.sleep, clock=time.monotonic):
        """Reads the open Dailies every DAILY_EVERY seconds, counted from each read's start,
        skipping a turn while a Refresh runs. A read fails when Steam couldn't be read
        (daily_watch.Watcher.read), so this is where a Steam outage of any kind reaches ops:
        once reads have failed for DAILY_OUTAGE, with the last one's lines, and again only
        after one has worked. A skipped turn neither starts an outage nor ends one."""
        failing_since, told = None, False
        while True:
            started = clock()
            if not self.daily_writers.locked():
                async with self.daily_writers:
                    self.daily_running = True
                    try:
                        code, lines = await self._run(
                            "daily", self.jobs.read_dailies, limit=DAILY_TIMEOUT
                        )
                    finally:
                        self.daily_running = False
                self.daily_last = {"started": datetime.now(UTC).isoformat(), "exit": code}
                if not code:
                    failing_since, told = None, False
                elif failing_since is None:
                    failing_since = started
                if code and not told and clock() - failing_since >= DAILY_OUTAGE:
                    told = True
                    await self.alert(
                        f"Collector: Daily reads have failed for {DAILY_OUTAGE // 60} minutes"
                        f" (exit {code}): Steam is down or the login is refused (a bad token"
                        " needs a new STEAM_REFRESH_TOKEN, tools/steampy_mint.py). They go on"
                        f" every {DAILY_EVERY} s; ops hears nothing more until one works.\n"
                        f"{_tail(lines)}"
                    )
            await sleep(max(0.0, DAILY_EVERY - (clock() - started)))

    def status(self):
        jobs = {name: job.status() for name, job in self.queue.items()}
        daily = {"running": self.daily_running, "waiting": False, "last": self.daily_last}
        return jobs | {"daily": daily}


class Collector:
    """The collector's jobs, run in this process on the one Steam `session`."""

    def __init__(self, session):
        self.session = session
        # what the Daily read holds between reads, read again after each Refresh
        self.watcher = None

    async def refresh(self):
        try:
            return await steampy_collect.refresh(self.session)
        finally:
            self.watcher = None

    async def map_files(self, maps, budget):
        return await map_files.download_due(self.session, maps=maps, budget=budget)

    async def add_maps(self):
        return await asyncio.to_thread(add_maps.add_new)

    async def read_dailies(self):
        if self.watcher is None:
            self.watcher = await daily_watch.Watcher.load()
        return await self.watcher.read(self.session)


async def post_ops(text):
    """Posts to the ops channel's webhook (OPS_WEBHOOK_URL), or only prints without one."""
    print(text, flush=True)
    url = os.environ.get("OPS_WEBHOOK_URL")
    if not url:
        return
    req = urllib.request.Request(  # noqa: S310 (the ops channel's https webhook)
        url,
        data=json.dumps({"content": text[:1990]}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "ballest-collector"},
    )
    try:
        await asyncio.to_thread(urllib.request.urlopen, req, timeout=30)
    except Exception as e:
        print(f"Posting to the ops channel failed: {e!r}", flush=True)


def app(service):
    """The private HTTP door."""

    def queue(start):
        async def handler(_request):
            queued = start()
            return web.json_response({"queued": queued}, status=202)

        return handler

    async def backlog(request):
        try:
            budget = int(request.query.get("budget", "3600"))
        except ValueError:
            return web.json_response({"error": "budget is a number of seconds"}, status=400)
        return web.json_response({"queued": service.map_file_backlog(budget)}, status=202)

    async def status(_request):
        return web.json_response(service.status())

    routes = web.Application()
    routes.add_routes(
        [
            web.post("/refresh", queue(service.refresh)),
            web.post("/add-maps", queue(service.add_maps)),
            web.post("/map-files", backlog),
            web.get("/", status),
        ]
    )
    return routes


def last_refresh():
    """When the last collector Refresh started, from the database it wrote."""
    import psycopg  # noqa: PLC0415 (only the service itself reads the database)

    with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=30) as conn:
        row = conn.execute(
            "select max(started_at) from refreshes where source = 'collector'"
        ).fetchone()
    return row[0]


async def schedule(service, *, now=lambda: datetime.now(UTC), sleep=asyncio.sleep, last=None):
    """Runs the Refresh at every slot, and at once when a slot was missed before this start.
    Each slot follows the last one fired, so a timer waking a moment early can't fire a slot
    twice."""
    try:
        last_started = await asyncio.to_thread(last or last_refresh)
    except Exception as e:
        print(f"Couldn't read the last Refresh ({e!r}); refreshing now", flush=True)
        last_started = None
    if due_on_start(last_started, now()):
        print(f"No Refresh since the last slot (last {last_started}); refreshing now", flush=True)
        service.refresh()
    slot = next_slot(now())
    while True:
        print(f"Next Refresh at {slot:%H:%M} UTC", flush=True)
        await sleep(max(0.0, (slot - now()).total_seconds()))
        service.refresh()
        slot += timedelta(hours=SLOT_HOURS)


async def serve():
    session = steam_session.SteamSession(cc.load_refresh_token())
    service = Service(Collector(session), post_ops)
    site_runner = web.AppRunner(app(service))
    await site_runner.setup()
    # "::" takes Fly's private IPv6 network, where Multiballs reaches it
    await web.TCPSite(site_runner, "::", PORT).start()
    print(f"Collector service listening on {PORT}", flush=True)
    if os.environ.get("REFRESH_SCHEDULE") == "off":
        print("REFRESH_SCHEDULE=off: the Refresh runs only when asked", flush=True)
        await asyncio.Event().wait()
    # the Daily read logs into Steam at once, and the session stays logged in from then on
    await asyncio.gather(schedule(service), service.watch_dailies())


def status():
    """`python runner.py status`: one line per job, `<job> running|waiting|idle last=<exit>`."""
    with urllib.request.urlopen(f"http://[::1]:{PORT}/", timeout=30) as r:
        for name, job in json.load(r).items():
            state = "running" if job["running"] else "waiting" if job["waiting"] else "idle"
            last = job["last"]["exit"] if job["last"] else "none"
            print(f"{name} {state} last={last}")
    return 0


def ask(job):
    """`python runner.py ask refresh|add-maps|map-files?budget=N`: queue a job on the service
    running beside it."""
    req = urllib.request.Request(f"http://[::1]:{PORT}/{job}", method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 (as above)
        print(r.read().decode(), "- follow it with `fly logs`")
    return 0


if __name__ == "__main__":
    if sys.argv[1:2] == ["ask"] and len(sys.argv) == 3:
        sys.exit(ask(sys.argv[2]))
    if sys.argv[1:] == ["status"]:
        sys.exit(status())
    asyncio.run(serve())
