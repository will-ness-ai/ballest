"""
The collector's service on Fly.io (app `ballest-collector`, tools/fly.toml; ADR 0012): one
always-on process that runs the collector's scripts, each as its own child process, exactly
as a workflow step ran them.

- The Refresh (steampy_collect.py) runs at every SLOT_HOURS slot, on the hour in UTC, and at
  DAILY_SLOT, just after the Daily opens; and at once on start when the last slot passed with
  no Refresh after it (a deploy or a crash stopped it; the Refresh is one transaction, so a
  killed one wrote nothing).
- `POST /add-maps`, from Multiballs when the game Discord's #new-tracks gets a post, adds the
  Workshop's newest Maps (add_maps.py, no Steam login), then downloads their files
  (map_files.py --maps).
- `POST /refresh` runs a Refresh now, in place of the Actions tab's "Run workflow" button:
  `fly ssh console -a ballest-collector -C "python /app/runner.py ask refresh"`.
- `POST /map-files?budget=SECONDS` downloads every due Map file within the budget, the
  backlog a Refresh's few minutes don't reach (map_files.py --budget), from
  `fly ssh console -a ballest-collector -C "python /app/runner.py ask map-files?budget=3600"`.
  It stops starting downloads BACKLOG_MARGIN before the next slot, so a Refresh never waits
  on it for long.
- `GET /` says what each job last did and whether one is running or waiting
  (`python /app/runner.py status` prints it a line a job).

Every job is a Job: at most one running and one waiting, and a request while one waits
folds into it, as an Actions concurrency group did. The jobs that log into Steam (the
Refresh and both kinds of file download) also take turns on one lock, since a second login on the
same account drops the first: that is the reason the service exists (ADR 0012).

A failed Refresh or Map add (or one whose script can't start) posts its last lines to the
private ops channel (OPS_WEBHOOK_URL), in place of Actions' failure emails; a failed download
only logs, since the next Refresh's Map file step downloads any file still due. The HTTP door
listens on Fly's private network only (no public address), so it takes no secret.

REFRESH_SCHEDULE=off leaves the Refresh to `POST /refresh`: for a first deploy while another
Refresh could still start elsewhere (the Actions cron did, until this service replaced it), or
locally, against a local database (the scripts write DATABASE_URL,
so never with production's in the environment):
  REFRESH_SCHEDULE=off DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev \\
    python tools/runner.py
"""

import asyncio
import collections
import json
import os
import sys
import tempfile
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta

from aiohttp import web

TOOLS = os.path.dirname(os.path.abspath(__file__))
SLOT_HOURS = 3
# One more slot a day, just after the Daily opens at 01:00 UTC (since 2026-09-05), so the
# site has the new Daily and the old one's final board within minutes, not at 03:00. A
# window that moves only delays the new Daily to the next SLOT_HOURS slot.
DAILY_SLOT = time(1, 5)
# a start this close to the next slot leaves the Refresh to that slot
SLOT_SOON = timedelta(minutes=30)
# a job still running after this is killed and counts as failed (a Refresh takes 2-6 minutes,
# a first one on an empty database ~12)
JOB_TIMEOUT = 60 * 60
# the backlog stops starting downloads this long before the next slot
BACKLOG_MARGIN = timedelta(minutes=15)
# seconds a backlog's last downloads may run past its budget; inside BACKLOG_MARGIN, so the
# slot's Refresh still starts on time
DOWNLOAD_GRACE = 10 * 60
# seconds to keep starting downloads of a new-tracks post's Maps, as add-maps.yml gave
NEW_MAP_FILES_BUDGET = 120
TAIL_LINES = 15
PORT = int(os.environ.get("PORT", "8080"))


def next_slot(now):
    """The first slot after `now`: the next whole SLOT_HOURS hour in UTC, or the Daily slot
    if it comes first."""
    start = now.replace(minute=0, second=0, microsecond=0)
    hourly = start + timedelta(hours=SLOT_HOURS - start.hour % SLOT_HOURS)
    daily = datetime.combine(now.date(), DAILY_SLOT, UTC)
    if daily <= now:
        daily += timedelta(days=1)
    return min(hourly, daily)


def last_slot(now):
    """The last slot at or before `now`."""
    start = now.replace(minute=0, second=0, microsecond=0)
    hourly = start - timedelta(hours=start.hour % SLOT_HOURS)
    daily = datetime.combine(now.date(), DAILY_SLOT, UTC)
    if daily > now:
        daily -= timedelta(days=1)
    return max(hourly, daily)


def due_on_start(last_refresh, now):
    """Whether a service starting at `now` runs a Refresh at once: the last slot passed with
    no Refresh after it, and the next one isn't about to come anyway."""
    missed = last_refresh is None or last_refresh < last_slot(now)
    return missed and next_slot(now) - now > SLOT_SOON


@dataclass
class Result:
    exit: int
    tail: list
    # what the script named in $GITHUB_OUTPUT (add_maps.py's `added`)
    outputs: dict = field(default_factory=dict)


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


class Service:
    """The jobs and the order they keep. `run(script, args, limit)` runs one script to a
    Result; `alert(text)` posts to the ops channel."""

    def __init__(self, run, alert, now=lambda: datetime.now(UTC)):
        self.run, self.alert, self.now = run, alert, now
        self.steam = asyncio.Lock()
        self.new_maps = set()
        self.jobs = {
            "refresh": Job(self._refresh),
            "add-maps": Job(self._add_maps),
            "new-map-files": Job(self._new_map_files),
            "map-files": Job(self._map_file_backlog),
        }
        self.backlog_budget = 0

    def refresh(self):
        return self.jobs["refresh"].request()

    def add_maps(self):
        return self.jobs["add-maps"].request()

    def map_file_backlog(self, budget):
        """Queue the backlog's downloads; a request while one waits sets its budget."""
        self.backlog_budget = budget
        return self.jobs["map-files"].request()

    async def _script(self, what, script, args, *, limit=JOB_TIMEOUT):
        """Runs one script and alerts the ops channel when it fails and `what` names it. A
        script that can't run at all fails with exit -1. A caller whose script logs into Steam
        holds self.steam around the call."""
        try:
            result = await self.run(script, args, limit)
        except Exception as e:
            result = Result(-1, [f"couldn't run {script}: {e!r}"])
        if result.exit and what:
            lines = "\n".join(result.tail)[-1500:]
            await self.alert(f"Collector: {what} failed (exit {result.exit}).\n```\n{lines}\n```")
        return result

    async def _refresh(self):
        async with self.steam:
            return (await self._script("Refresh", "steampy_collect.py", [])).exit

    async def _add_maps(self):
        result = await self._script("Adding new Maps", "add_maps.py", [])
        added = [p for p in result.outputs.get("added", "").split(",") if p]
        if added:
            self.new_maps.update(added)
            self.jobs["new-map-files"].request()
        return result.exit

    async def _new_map_files(self):
        # the Maps are taken once the lock is, so Maps added while this waits come along
        async with self.steam:
            maps, self.new_maps = sorted(self.new_maps), set()
            args = ["--maps", ",".join(maps), "--budget", str(NEW_MAP_FILES_BUDGET)]
            return (await self._script(None, "map_files.py", args)).exit

    async def _map_file_backlog(self):
        # stops starting downloads BACKLOG_MARGIN before the next slot, counted once it holds
        # the lock, so the slot's Refresh isn't kept waiting on Steam; the downloads under way
        # finish within DOWNLOAD_GRACE
        async with self.steam:
            to_slot = (next_slot(self.now()) - self.now() - BACKLOG_MARGIN).total_seconds()
            budget = min(self.backlog_budget, int(to_slot))
            if budget <= 0:
                print("Map file backlog: no time left before the slot; not logging in", flush=True)
                return 0
            args, limit = ["--budget", str(budget)], budget + DOWNLOAD_GRACE
            return (await self._script(None, "map_files.py", args, limit=limit)).exit

    def status(self):
        return {name: job.status() for name, job in self.jobs.items()}


async def run_script(script, args, limit=JOB_TIMEOUT):
    """Runs tools/<script> as a child process with this process's environment, its output
    passed on to the log line by line under the script's name, killed after `limit` seconds."""
    with tempfile.NamedTemporaryFile("r", suffix=".out") as out:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-u",
            os.path.join(TOOLS, script),
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "GITHUB_OUTPUT": out.name},
            limit=1 << 20,  # the longest line read; a longer one ends the run, killed below
        )
        tail = collections.deque(maxlen=TAIL_LINES)
        name = script.removesuffix(".py")

        async def relay():
            async for raw in proc.stdout:
                line = raw.decode(errors="replace").rstrip()
                tail.append(line)
                print(f"[{name}] {line}", flush=True)

        try:
            await asyncio.wait_for(asyncio.gather(relay(), proc.wait()), limit)
        except TimeoutError:
            tail.append(f"(killed after {limit // 60} minutes)")
        finally:
            # never leave a child logged into Steam once its turn on the lock is over
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
        outputs = dict(line.split("=", 1) for line in out.read().splitlines() if "=" in line)
        return Result(proc.returncode, list(tail), outputs)


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
        slot = next_slot(slot)


async def serve():
    service = Service(run_script, post_ops)
    site_runner = web.AppRunner(app(service))
    await site_runner.setup()
    # "::" takes Fly's private IPv6 network, where Multiballs reaches it
    await web.TCPSite(site_runner, "::", PORT).start()
    print(f"Collector service listening on {PORT}", flush=True)
    if os.environ.get("REFRESH_SCHEDULE") == "off":
        print("REFRESH_SCHEDULE=off: the Refresh runs only when asked", flush=True)
        await asyncio.Event().wait()
    await schedule(service)


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
