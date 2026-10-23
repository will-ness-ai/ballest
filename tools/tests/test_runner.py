"""The collector's service on Fly (tools/runner.py): when the Refresh is due, which jobs wait
for which, what reaches the ops channel, and the private HTTP door Multiballs knocks on."""

import asyncio
import io
import socket
from datetime import UTC, datetime, timedelta

import pytest
import runner
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer


def at(hhmm, day=18):
    h, m = map(int, hhmm.split(":"))
    return datetime(2026, 10, day, h, m, tzinfo=UTC)


@pytest.mark.parametrize(
    ("now", "slot"),
    [
        ("00:00", "03:00"),  # a slot that is now has just been taken
        ("01:30", "03:00"),
        ("20:59", "21:00"),
        ("21:00", "00:00+1"),
    ],
)
def test_the_next_slot_is_the_next_multiple_of_three_hours(now, slot):
    hhmm, _, plus = slot.partition("+")
    assert runner.next_slot(at(now)) == at(hhmm, 18 + int(plus or 0))


def test_a_start_after_a_missed_slot_refreshes_at_once():
    # the 15:00 slot passed with no Refresh after it (a deploy killed it, or the machine was down)
    assert runner.due_on_start(at("12:01"), at("15:20"))
    assert runner.due_on_start(None, at("15:20"))


def test_a_start_after_a_kept_slot_waits_for_the_next():
    assert not runner.due_on_start(at("15:00"), at("15:20"))


def test_a_start_just_before_a_slot_leaves_it_to_the_slot():
    assert not runner.due_on_start(at("12:01"), at("17:40"))


class Fake:
    """Stands in for the collector's jobs (runner.Collector): each run waits on its own gate,
    so a test decides when it ends, and every start and end is logged in order."""

    def __init__(self, added=(), codes=None):
        self.log, self.gates, self.alerts = [], {}, []
        self.added, self.codes = list(added), codes or {}

    def gate(self, job):
        return self.gates.setdefault(job, asyncio.Event())

    async def _run(self, job, *args):
        self.log.append(("start", job, *args))
        print(f"{job} said hi")
        await self.gate(job).wait()
        self.gates.pop(job, None)
        self.log.append(("end", job))
        return self.codes.get(job, 0)

    async def refresh(self):
        return await self._run("refresh")

    async def map_files(self, maps, budget):
        return await self._run("map_files", *([",".join(sorted(maps))] if maps else []), budget)

    async def add_maps(self):
        code = await self._run("add_maps")
        if code:
            raise RuntimeError("the database said no")
        return self.added

    async def read_dailies(self):
        return await self._run("read_dailies")

    async def alert(self, text):
        self.alerts.append(text)


async def settle():
    for _ in range(20):
        await asyncio.sleep(0)


def service(fake, now="12:00"):
    return runner.Service(fake, fake.alert, now=lambda: at(now))


def test_requests_while_one_waits_fold_into_it():
    async def go():
        fake = Fake()
        s = service(fake)
        s.refresh()
        await settle()
        assert s.refresh()  # one more may wait behind the running one
        assert not s.refresh()  # and that one stands for any after it
        fake.gate("refresh").set()
        await settle()
        fake.gate("refresh").set()
        await settle()
        assert fake.log == [("start", "refresh"), ("end", "refresh")] * 2

    asyncio.run(go())


def test_file_downloads_wait_for_the_refresh():
    async def go():
        fake = Fake(added=["3822432182", "3822400116"])
        s = service(fake)
        s.refresh()
        await settle()
        s.add_maps()
        await settle()
        # adding runs beside the Refresh
        assert ("start", "add_maps") in fake.log
        fake.gate("add_maps").set()
        await settle()
        # but the new Maps' files wait for it, so two never download one Map's file at once
        assert not any(e[1] == "map_files" for e in fake.log)
        fake.gate("refresh").set()
        await settle()
        assert fake.log[-1] == ("start", "map_files", "3822400116,3822432182", 120)

    asyncio.run(go())


def test_nothing_added_downloads_nothing():
    async def go():
        fake = Fake()
        s = service(fake)
        s.add_maps()
        await settle()
        fake.gate("add_maps").set()
        await settle()
        assert [e[1] for e in fake.log] == ["add_maps", "add_maps"]

    asyncio.run(go())


def test_a_failed_refresh_reaches_the_ops_channel_with_its_last_lines():
    async def go():
        fake = Fake(codes={"refresh": 1})
        s = service(fake)
        s.refresh()
        await settle()
        fake.gate("refresh").set()
        await settle()
        assert len(fake.alerts) == 1
        assert "Refresh failed (exit 1)" in fake.alerts[0]
        assert "refresh said hi" in fake.alerts[0]

    asyncio.run(go())


def test_a_failed_file_download_stays_in_the_log():
    # the next Refresh's Map file step downloads any file still due
    async def go():
        fake = Fake(added=["1"], codes={"map_files": 1})
        s = service(fake)
        s.add_maps()
        await settle()
        fake.gate("add_maps").set()
        await settle()
        fake.gate("map_files").set()
        await settle()
        assert fake.alerts == []

    asyncio.run(go())


def test_the_file_backlog_takes_its_turn_with_its_own_budget():
    async def go():
        fake = Fake()
        s = service(fake)
        s.refresh()
        await settle()
        s.map_file_backlog(3600)  # at 12:00: the 15:00 slot is well clear of it
        await settle()
        assert not any(e[1] == "map_files" for e in fake.log)
        fake.gate("refresh").set()
        await settle()
        assert fake.log[-1] == ("start", "map_files", 3600)
        fake.gate("map_files").set()
        await settle()

    asyncio.run(go())


def test_the_backlog_stops_starting_downloads_before_the_next_slot():
    async def go():
        fake = Fake()
        s = service(fake, now="14:00")
        s.map_file_backlog(3600)
        await settle()
        # 45 minutes to the margin before 15:00, so the slot's Refresh needn't wait for it
        assert fake.log[-1] == ("start", "map_files", 2700)
        # and the last downloads end before the slot, which is the margin's whole point
        assert runner.BACKLOG_MARGIN.total_seconds() > runner.DOWNLOAD_GRACE
        fake.gate("map_files").set()
        await settle()

    asyncio.run(go())


def test_the_backlog_counts_its_budget_from_its_turn():
    async def go():
        fake, clock = Fake(), [at("14:00")]
        s = runner.Service(fake, fake.alert, now=lambda: clock[0])
        s.refresh()
        await settle()
        s.map_file_backlog(3600)
        await settle()
        clock[0] = at("14:10")  # the Refresh ran for ten minutes
        fake.gate("refresh").set()
        await settle()
        assert fake.log[-1] == ("start", "map_files", 2100)
        fake.gate("map_files").set()
        await settle()

    asyncio.run(go())


def test_a_backlog_asked_for_inside_the_margin_downloads_nothing():
    async def go():
        fake = Fake()
        s = service(fake, now="14:50")
        s.map_file_backlog(3600)
        await settle()
        assert fake.log == []
        assert s.status()["map-files"]["last"]["exit"] == 0

    asyncio.run(go())


def test_a_failed_map_add_reaches_the_ops_channel():
    async def go():
        fake = Fake(codes={"add_maps": 1})
        s = service(fake)
        s.add_maps()
        await settle()
        fake.gate("add_maps").set()
        await settle()
        assert "Adding new Maps failed (exit -1)" in fake.alerts[0]
        assert "the database said no" in fake.alerts[0]

    asyncio.run(go())


def test_a_job_that_raises_alerts_and_frees_its_turn():
    async def go():
        fake = Fake()
        s = service(fake)

        async def broken():
            raise OSError("no database")

        fake.refresh = broken
        s.refresh()
        await settle()
        assert "Refresh failed" in fake.alerts[0]
        assert "no database" in fake.alerts[0]
        assert s.status()["refresh"]["last"]["exit"] != 0
        assert not s.map_file_writers.locked()

    asyncio.run(go())


def test_a_job_whose_own_wait_times_out_fails_like_any_error():
    async def go():
        fake = Fake()
        s = service(fake)

        async def gave_up():
            raise TimeoutError("Steam never answered")

        fake.refresh = gave_up
        s.refresh()
        await settle()
        assert "Refresh failed (exit -1)" in fake.alerts[0]
        assert "Steam never answered" in fake.alerts[0]
        assert not s.map_file_writers.locked()

    asyncio.run(go())


def test_a_job_past_its_time_is_stopped_and_fails(monkeypatch):
    monkeypatch.setattr(runner, "JOB_TIMEOUT", 0.05)

    async def go():
        fake = Fake()
        s = service(fake)
        s.refresh()
        await asyncio.sleep(0.2)
        assert "Refresh failed" in fake.alerts[0]
        assert "stopped after" in fake.alerts[0]
        assert not s.map_file_writers.locked()

    asyncio.run(go())


def test_what_a_job_raises_while_being_stopped_stays_in_its_alert(monkeypatch):
    monkeypatch.setattr(runner, "JOB_TIMEOUT", 0.05)

    async def go():
        fake = Fake()
        s = service(fake)

        async def stuck():
            try:
                await asyncio.sleep(10)
            finally:
                raise OSError("rollback failed")

        fake.refresh = stuck
        s.refresh()
        await asyncio.sleep(0.2)
        assert "stopped after" in fake.alerts[0]
        assert "rollback failed" in fake.alerts[0]

    asyncio.run(go())


def test_each_slot_runs_one_refresh_even_when_the_timer_wakes_early():
    async def go():
        clock = [at("12:10")]
        requests = []

        class Counting:
            def refresh(self):
                requests.append(clock[0])

        async def sleep(seconds):
            if len(requests) >= 3:
                raise asyncio.CancelledError
            # wakes a hair before the slot, as the loop's timer may
            clock[0] += timedelta(seconds=seconds) - timedelta(milliseconds=1)

        with pytest.raises(asyncio.CancelledError):
            await runner.schedule(
                Counting(), now=lambda: clock[0], sleep=sleep, last=lambda: at("12:00")
            )
        assert [r.hour for r in requests] == [14, 17, 20]

    asyncio.run(go())


def test_the_http_door_queues_jobs_and_reports_them():
    async def go():
        fake = Fake()
        s = service(fake)
        async with TestClient(TestServer(runner.app(s))) as http:
            assert (await http.post("/add-maps")).status == 202
            await settle()
            assert (await http.post("/refresh")).status == 202
            await settle()
            fake.gate("add_maps").set()
            await settle()
            status = await (await http.get("/")).json()
            assert status["add-maps"]["last"]["exit"] == 0
            assert status["refresh"]["running"]
            assert (await http.post("/map-files?budget=600")).status == 202
            fake.gate("refresh").set()
            await settle()
            assert fake.log[-1] == ("start", "map_files", 600)
            assert (await http.post("/map-files?budget=lots")).status == 400
            fake.gate("map_files").set()
            await settle()

    asyncio.run(go())


def test_the_commands_reach_the_service_where_it_listens(monkeypatch, capsys):
    # it binds "::" for Fly's private network, which takes no IPv4, so localhost's 127.0.0.1
    # in the image's /etc/hosts would find nothing (the first production deploy, 2026-10-18)
    try:
        with socket.socket(socket.AF_INET6) as s:
            s.bind(("::1", 0))
            port = s.getsockname()[1]
    except OSError:
        pytest.skip("no IPv6 loopback here (a cloud container has none; CI's runner does)")
    monkeypatch.setattr(runner, "PORT", port)

    async def go():
        site_runner = web.AppRunner(runner.app(service(Fake())))
        await site_runner.setup()
        await web.TCPSite(site_runner, "::", port).start()
        try:
            await asyncio.to_thread(runner.status)
        finally:
            await site_runner.cleanup()

    asyncio.run(go())
    assert "refresh idle last=none" in capsys.readouterr().out


# Each job's output, in the one process all of them share.


def test_each_jobs_output_is_named_in_the_log_and_kept_for_its_alert():
    async def go():
        out = io.StringIO()
        logs = runner.JobLog(out)

        async def job(name):
            with logs.job(name) as tail:
                print("reading", end="", file=logs)
                await asyncio.sleep(0)
                print(" boards", file=logs)
                await asyncio.to_thread(print, "names done", file=logs)
                return list(tail)

        tails = await asyncio.gather(job("refresh"), job("daily"))
        assert tails == [["reading boards", "names done"]] * 2
        assert sorted(out.getvalue().splitlines()) == sorted(
            [
                "[refresh] reading boards",
                "[refresh] names done",
                "[daily] reading boards",
                "[daily] names done",
            ]
        )

    asyncio.run(go())


# The Daily read: every DAILY_EVERY seconds on the one Steam session.


async def watching(s, **kw):
    task = asyncio.create_task(s.watch_dailies(**kw))
    await settle()
    return task


def ticker():
    """A sleep that returns at once and counts its calls, for the Daily loop."""
    ticks = []

    async def sleep(seconds):
        ticks.append(seconds)
        await asyncio.sleep(0)

    return ticks, sleep


def test_the_daily_read_goes_on_through_a_file_download():
    async def go():
        fake = Fake()
        s = service(fake)
        s.map_file_backlog(600)
        await settle()
        _, sleep = ticker()
        task = await watching(s, sleep=sleep)
        for _ in range(3):
            fake.gate("read_dailies").set()
            await settle()
        assert ("end", "map_files") not in fake.log
        assert fake.log.count(("end", "read_dailies")) == 3
        task.cancel()
        fake.gate("map_files").set()
        await settle()

    asyncio.run(go())


def test_the_daily_read_skips_while_a_refresh_runs():
    # the Refresh reads and writes the Dailies itself
    async def go():
        fake = Fake()
        s = service(fake)
        s.refresh()
        await settle()
        ticks, sleep = ticker()
        task = await watching(s, sleep=sleep)
        assert ("start", "read_dailies") not in fake.log
        assert len(ticks) > 1  # it kept to its minute, reading nothing
        fake.gate("refresh").set()
        await settle()
        assert fake.log[-1] == ("start", "read_dailies")
        task.cancel()

    asyncio.run(go())


def test_a_turn_skipped_for_a_refresh_neither_starts_nor_ends_an_outage():
    async def go():
        fake = Fake(codes={"read_dailies": 1})
        s = service(fake)
        now = [0.0]

        async def sleep(_seconds):
            now[0] += runner.DAILY_EVERY
            await asyncio.sleep(0)

        task = await watching(s, sleep=sleep, clock=lambda: now[0])
        s.refresh()  # waits for the read under way, which fails: the outage starts
        fake.gate("read_dailies").set()
        await settle()
        assert s.daily_writers.locked()  # the Refresh's turns pass half an hour with no read
        while now[0] < runner.DAILY_OUTAGE:
            await settle()
        assert fake.alerts == []
        fake.gate("refresh").set()
        await settle()
        fake.gate("read_dailies").set()  # the next read fails: it has been down half an hour
        await settle()
        assert len(fake.alerts) == 1
        task.cancel()

    asyncio.run(go())


def test_a_refresh_waits_for_a_daily_read_under_way():
    async def go():
        fake = Fake()
        s = service(fake)
        _, sleep = ticker()
        task = await watching(s, sleep=sleep)
        s.refresh()
        await settle()
        assert fake.log == [("start", "read_dailies")]
        fake.gate("read_dailies").set()
        await settle()
        assert fake.log[-1] == ("start", "refresh")
        task.cancel()
        fake.gate("refresh").set()
        await settle()

    asyncio.run(go())


def test_daily_reads_keep_to_their_minute():
    async def go():
        fake = Fake()
        s = service(fake)
        ticks, sleep = ticker()
        clock = [0.0]
        task = await watching(s, sleep=sleep, clock=lambda: clock[0])
        clock[0] = 12.5  # the read took 12.5 s
        fake.gate("read_dailies").set()
        await settle()
        assert ticks[0] == runner.DAILY_EVERY - 12.5
        task.cancel()

    asyncio.run(go())


def test_ops_hears_of_failing_daily_reads_once_they_have_failed_half_an_hour():
    async def go():
        fake = Fake(codes={"read_dailies": 1})
        s = service(fake)
        now = [0.0]

        async def sleep(_seconds):
            now[0] += runner.DAILY_EVERY
            await asyncio.sleep(0)

        task = await watching(s, sleep=sleep, clock=lambda: now[0])

        async def read_for(minutes):
            for _ in range(minutes):
                fake.gate("read_dailies").set()
                await settle()

        await read_for(runner.DAILY_OUTAGE // 60)  # Steam's usual short drop: ops hears nothing
        assert fake.alerts == []
        await read_for(5)
        assert len(fake.alerts) == 1
        assert "Daily reads have failed for 30 minutes" in fake.alerts[0]
        assert "read_dailies said hi" in fake.alerts[0]  # the last read's lines, for the cause
        fake.codes = {}
        await read_for(1)  # one works: the next outage is counted afresh
        fake.codes = {"read_dailies": 1}
        await read_for(runner.DAILY_OUTAGE // 60)
        assert len(fake.alerts) == 1
        await read_for(2)
        assert len(fake.alerts) == 2
        task.cancel()

    asyncio.run(go())


# The real jobs (runner.Collector): what the Daily read holds is read again after a Refresh.


def test_after_a_refresh_the_daily_read_starts_again_from_the_database(monkeypatch):
    loads = []

    class Loaded:
        async def read(self, _session):
            return 0

    async def load():
        loads.append(1)
        return Loaded()

    async def refresh(_session):
        return 0

    monkeypatch.setattr(runner.daily_watch.Watcher, "load", staticmethod(load))
    monkeypatch.setattr(runner.steampy_collect, "refresh", refresh)

    async def go():
        c = runner.Collector(None)
        await c.read_dailies()
        await c.read_dailies()
        assert len(loads) == 1
        await c.refresh()
        await c.read_dailies()
        assert len(loads) == 2

    asyncio.run(go())


def test_the_status_shows_a_daily_read_under_way_while_a_refresh_waits():
    async def go():
        fake = Fake()
        s = service(fake)
        _, sleep = ticker()
        task = await watching(s, sleep=sleep)
        s.refresh()
        await settle()
        assert s.status()["daily"]["running"]
        fake.gate("read_dailies").set()
        await settle()
        assert not s.status()["daily"]["running"]
        task.cancel()
        fake.gate("refresh").set()
        await settle()

    asyncio.run(go())
