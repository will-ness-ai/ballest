"""The Daily read the collector's service runs every minute (tools/daily_watch.py): what it
writes, and what it does when the write fails."""

import asyncio
import dataclasses

import daily_watch
import db_writer
import pytest
from test_daily import OCT19, a_daily, read_of

OCT20 = a_daily("2026-10-20", "2026-10-20T01:00", "2026-10-21T01:00")


class Fakes:
    """The Steam read (collect_dailies) and the database write the Watcher makes."""

    def __init__(self, *reads):
        self.reads, self.written, self.fail = list(reads), [], False

    async def collect(self, *_args):
        due = self.reads.pop(0)
        return due if isinstance(due, list) else [due]

    async def write(self, refresh, **_kw):
        if self.fail:
            return None
        self.written.append(refresh)
        return len(self.written)


def test_run_on_its_own_with_no_token_it_stops_at_once(monkeypatch, capsys):
    monkeypatch.setattr(daily_watch.cc, "load_refresh_token", lambda: None)
    assert daily_watch.main() == 2
    assert "STEAM_REFRESH_TOKEN" in capsys.readouterr().out


def opened(r):
    """A read of a Daily just opened: Steam answered with no rows (a failed read has None)."""
    return dataclasses.replace(r, rows=[])


def watcher(fakes):
    return daily_watch.Watcher(db_writer.Memory(), collect=fakes.collect, write=fakes.write)


def test_a_read_writes_a_new_daily_as_a_daily_read_and_then_only_what_moved():
    fakes = Fakes(
        opened(read_of(OCT19, "2026-10-19T01:00")),  # nobody has a time yet
        opened(read_of(OCT19, "2026-10-19T01:01")),
        read_of(OCT19, "2026-10-19T01:02", ("1", 900)),
    )
    w = watcher(fakes)
    assert [asyncio.run(w.read(Steam())) for _ in range(3)] == [0, 0, 0]
    assert len(fakes.written) == 2
    assert {r.source for r in fakes.written} == {"daily"}
    assert fakes.written[1].dailies[0].rows[0]["persona"] == ""


def test_a_failed_write_fails_the_read_and_the_next_read_writes_it():
    fakes = Fakes(
        read_of(OCT19, "2026-10-19T01:01", ("1", 900)),
        read_of(OCT19, "2026-10-19T01:02", ("1", 900)),
    )
    w = watcher(fakes)
    fakes.fail = True
    assert asyncio.run(w.read(Steam())) == 1
    fakes.fail = False
    assert asyncio.run(w.read(Steam())) == 0
    assert len(fakes.written) == 1


class Steam:
    """The session: logged in, or not (ready raises as SteamSession.ready does)."""

    def __init__(self, *, up=True):
        self.up = up

    async def ready(self):
        if not self.up:
            raise ConnectionError("Steam down: InvalidPassword")


def test_every_read_checks_the_login_even_with_nothing_due():
    # how a Steam outage reaches ops (runner.DAILY_OUTAGE), whatever is due
    fakes = Fakes()
    fakes.collect = lambda *_a: pytest.fail("read with no login")
    with pytest.raises(ConnectionError):
        asyncio.run(watcher(fakes).read(Steam(up=False)))


def test_one_board_that_fails_is_no_outage_but_all_failing_is():
    # a Daily whose board won't read (a wrong ID) waits for the next read; when every board
    # fails, Steam is answering nothing, logged in or not
    w = watcher(Fakes())
    w.watch.wrote(
        [
            read_of(OCT19, "2026-10-19T01:00", ("1", 900)),
            read_of(OCT20, "2026-10-20T01:00", ("1", 900)),
        ]
    )
    failed, still = (
        read_of(OCT19, "2026-10-20T02:00"),
        read_of(OCT20, "2026-10-20T02:00", ("1", 900)),
    )
    w.collect = Fakes([failed, still]).collect
    assert asyncio.run(w.read(Steam())) == 0
    w.collect = Fakes([failed, read_of(OCT20, "2026-10-20T02:01")]).collect
    assert asyncio.run(w.read(Steam())) == 1
