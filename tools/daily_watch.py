"""
The Daily read (runner.py on Fly): the open Dailies read on the service's one Steam session
every minute (runner.DAILY_EVERY), so the site's Daily pages follow the board within a minute or so,
between Refreshes (CONTEXT.md, "Daily read").

Each read that moved a Daily's board, or makes it final, is written as a Daily read
(db_writer.Refresh with source "daily"): the Dailies only, which counts as no Refresh, and
revalidates only the Daily pages. A read that changed nothing writes nothing. The service
runs `Watcher.read` on its timer and loads a new Watcher after each Refresh, which reads and
writes the Dailies itself.

Run on its own, it logs into Steam for one read. Same secrets as steampy_collect.py; --dev
writes only DEV_DATABASE_URL.
"""

import asyncio
import os
import sys
from datetime import UTC, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc
import daily
import db_writer
import steam_session  # first: it silences steam.py's warnings before steampy_common's import
from steampy_common import collect_dailies


def fill_names(rows, names, key):
    """Put names on the rows: the database's, and Steam's for a player it has none for."""
    new = {r["steam_id"] for r in rows} - set(names)
    if new and key:
        names.update(cc.resolve_names(key, new))
    cc.fill_names([rows], names)


class Watcher:
    """What the Daily read holds between reads (daily.Watch, and the players' names), from
    the collector's Memory. `collect` reads the Dailies from Steam (collect_dailies) and
    `write` puts a Daily read in the database (db_writer.record)."""

    def __init__(
        self,
        memory,
        *,
        dev=False,
        key=None,
        collect=collect_dailies,
        write=db_writer.record,
    ):
        self.watch = daily.Watch(memory.dailies, memory.daily_boards)
        self.names = {sid: dict(v) for sid, v in memory.names.items()}
        self.dev, self.key, self.collect, self.write = dev, key, collect, write

    @classmethod
    async def load(cls, *, dev=False):
        """A Watcher from the database's Memory; raises when it can't be read."""
        memory = await asyncio.to_thread(db_writer.load_memory, scratch=dev)
        if memory is None:
            raise RuntimeError("couldn't read the collector's memory")
        return cls(memory, dev=dev, key=cc.load_key())

    async def read(self, session):
        """One read on the Steam `session`, writing what moved: 0, or 1 when the write failed
        (the next read still sees the change and tries again)."""
        since = daily.watch_since(datetime.now(UTC))
        reads = await self.collect(session, self.watch.known, set(), since)
        fresh = self.watch.to_write(reads)
        if not fresh:
            return 0
        for r in fresh:
            await asyncio.to_thread(fill_names, r.rows or [], self.names, self.key)
        refresh = db_writer.Refresh(
            started_at=datetime.now(UTC), dailies=tuple(fresh), source="daily"
        )
        if await self.write(refresh, scratch=self.dev) is None:
            return 1
        self.watch.wrote(fresh)
        return 0


def main():
    """One read, logged into Steam for it."""
    dev = "--dev" in sys.argv[1:]

    async def read(session):
        return await (await Watcher.load(dev=dev)).read(session)

    return steam_session.run_alone(read)


if __name__ == "__main__":
    sys.exit(main())
