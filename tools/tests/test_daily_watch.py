"""The Daily read the collector's service runs every minute (tools/daily_watch.py): what it
writes, and what it does when the write fails."""

import asyncio

import daily_watch
import db_writer
from test_daily import OCT19, read_of


class Fakes:
    """The Steam read (collect_dailies) and the database write the Watcher makes."""

    def __init__(self, *reads):
        self.reads, self.written, self.fail = list(reads), [], False

    async def collect(self, *_args):
        return [self.reads.pop(0)]

    def write(self, refresh, **_kw):
        if self.fail:
            return None
        self.written.append(refresh)
        return len(self.written)


def watcher(fakes):
    return daily_watch.Watcher(db_writer.Memory(), collect=fakes.collect, write=fakes.write)


def test_a_read_writes_a_new_daily_as_a_daily_read_and_then_only_what_moved():
    fakes = Fakes(
        read_of(OCT19, "2026-10-19T01:00"),  # just opened: nobody has a time yet
        read_of(OCT19, "2026-10-19T01:01"),
        read_of(OCT19, "2026-10-19T01:02", ("1", 900)),
    )
    w = watcher(fakes)
    assert [asyncio.run(w.read(None)) for _ in range(3)] == [0, 0, 0]
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
    assert asyncio.run(w.read(None)) == 1
    fakes.fail = False
    assert asyncio.run(w.read(None)) == 0
    assert len(fakes.written) == 1
