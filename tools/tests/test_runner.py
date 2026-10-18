"""The collector's service on Fly (tools/runner.py): when the Refresh is due, which jobs wait
for which, what reaches the ops channel, and the private HTTP door Multiballs knocks on."""

import asyncio
from datetime import UTC, datetime

import pytest
import runner
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
    """Runs instead of the real scripts: each script's run waits on its own gate, so a test
    decides when it ends, and every start and end is logged in order."""

    def __init__(self, outputs=None, codes=None):
        self.log, self.gates, self.alerts, self.limits = [], {}, [], []
        self.outputs, self.codes = outputs or {}, codes or {}

    def gate(self, script):
        return self.gates.setdefault(script, asyncio.Event())

    async def run(self, script, args, limit=runner.JOB_TIMEOUT):
        self.log.append(("start", script, *args))
        self.limits.append(limit)
        await self.gate(script).wait()
        self.gates.pop(script)
        self.log.append(("end", script))
        return runner.Result(
            self.codes.get(script, 0), [f"{script} said hi"], self.outputs.get(script, {})
        )

    async def alert(self, text):
        self.alerts.append(text)


async def settle():
    for _ in range(20):
        await asyncio.sleep(0)


def service(fake):
    return runner.Service(fake.run, fake.alert)


def test_requests_while_one_waits_fold_into_it():
    async def go():
        fake = Fake()
        s = service(fake)
        s.refresh()
        await settle()
        assert s.refresh()  # one more may wait behind the running one
        assert not s.refresh()  # and that one stands for any after it
        fake.gate("steampy_collect.py").set()
        await settle()
        fake.gate("steampy_collect.py").set()
        await settle()
        assert [e[:2] for e in fake.log] == [
            ("start", "steampy_collect.py"),
            ("end", "steampy_collect.py"),
        ] * 2

    asyncio.run(go())


def test_steam_jobs_never_overlap():
    async def go():
        fake = Fake(outputs={"add_maps.py": {"added": "3822432182,3822400116"}})
        s = service(fake)
        s.refresh()
        await settle()
        s.add_maps()
        await settle()
        # adding needs no Steam login, so it runs beside the Refresh
        assert ("start", "add_maps.py") in fake.log
        fake.gate("add_maps.py").set()
        await settle()
        # but the new Maps' files need one, so they wait for the Refresh to log off
        assert not any(e[1] == "map_files.py" for e in fake.log)
        fake.gate("steampy_collect.py").set()
        await settle()
        assert fake.log[-1] == (
            "start",
            "map_files.py",
            "--maps",
            "3822400116,3822432182",
            "--budget",
            "120",
        )

    asyncio.run(go())


def test_nothing_added_downloads_nothing():
    async def go():
        fake = Fake()
        s = service(fake)
        s.add_maps()
        await settle()
        fake.gate("add_maps.py").set()
        await settle()
        assert [e[1] for e in fake.log] == ["add_maps.py", "add_maps.py"]

    asyncio.run(go())


def test_a_failed_refresh_reaches_the_ops_channel_with_its_last_lines():
    async def go():
        fake = Fake(codes={"steampy_collect.py": 1})
        s = service(fake)
        s.refresh()
        await settle()
        fake.gate("steampy_collect.py").set()
        await settle()
        assert len(fake.alerts) == 1
        assert "Refresh failed (exit 1)" in fake.alerts[0]
        assert "steampy_collect.py said hi" in fake.alerts[0]

    asyncio.run(go())


def test_a_failed_file_download_stays_in_the_log():
    # the next Refresh's Map file step downloads any file still due
    async def go():
        fake = Fake(outputs={"add_maps.py": {"added": "1"}}, codes={"map_files.py": 1})
        s = service(fake)
        s.add_maps()
        await settle()
        fake.gate("add_maps.py").set()
        await settle()
        fake.gate("map_files.py").set()
        await settle()
        assert fake.alerts == []

    asyncio.run(go())


def test_the_file_backlog_takes_its_turn_on_steam_with_its_own_budget():
    async def go():
        fake = Fake()
        s = service(fake)
        s.refresh()
        await settle()
        s.map_file_backlog(3600)
        await settle()
        assert not any(e[1] == "map_files.py" for e in fake.log)
        fake.gate("steampy_collect.py").set()
        await settle()
        assert fake.log[-1] == ("start", "map_files.py", "--budget", "3600")
        # its downloads may run past the budget; the timeout leaves room for them
        assert fake.limits[-1] > 3600
        fake.gate("map_files.py").set()
        await settle()

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
            fake.gate("add_maps.py").set()
            await settle()
            status = await (await http.get("/")).json()
            assert status["add-maps"]["last"]["exit"] == 0
            assert status["refresh"]["running"]
            assert (await http.post("/map-files?budget=600")).status == 202
            fake.gate("steampy_collect.py").set()
            await settle()
            assert fake.log[-1] == ("start", "map_files.py", "--budget", "600")
            assert (await http.post("/map-files?budget=lots")).status == 400
            fake.gate("map_files.py").set()
            await settle()

    asyncio.run(go())


def test_a_script_runs_as_a_workflow_step_ran_it(tmp_path, monkeypatch):
    (tmp_path / "step.py").write_text(
        "import os, sys\n"
        "for n in range(20): print('line', n)\n"
        "open(os.environ['GITHUB_OUTPUT'], 'a').write('added=1,2\\n')\n"
        "sys.exit(3)\n"
    )
    monkeypatch.setattr(runner, "TOOLS", str(tmp_path))
    result = asyncio.run(runner.run_script("step.py", []))
    assert result.exit == 3
    assert result.tail == [f"line {n}" for n in range(5, 20)]
    assert result.outputs == {"added": "1,2"}
