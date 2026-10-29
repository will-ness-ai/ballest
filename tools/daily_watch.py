"""
The Daily watcher (runner.py on Fly): logs into Steam once and reads the open Dailies every
DAILY_EVERY seconds, so the site's Daily pages follow the board within a minute or so,
between Refreshes (GLOSSARY.md, "Daily read").

Each read that moved a Daily's board, or makes it final, is written as a Daily read
(db_writer.Refresh with source "daily"): the Dailies only, which counts as no Refresh, and
revalidates only the Daily pages. A read that changed nothing writes nothing. It runs until
it is stopped: runner.py stops it whenever another job needs Steam (one login at a time on
this account) and starts it again after. It exits 1 when Steam drops it or a read raises,
and runner.py starts it again.

Same secrets as steampy_collect.py; --dev writes only DEV_DATABASE_URL.
"""

import asyncio
import logging
import os
import sys
import time
import traceback
import warnings
from datetime import UTC, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc
import daily
import db_writer

warnings.filterwarnings("ignore")  # silence steam.py's XML-as-HTML parser warning

import steam  # noqa: E402 (after the warnings filter)
from steampy_common import collect_dailies  # noqa: E402

logging.basicConfig(level=logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.CRITICAL)

# seconds between two reads, counted from each read's start
DAILY_EVERY = 60
DEV = "--dev" in sys.argv[1:]

client = steam.Client()
_state = {"started": False, "memory": None}


def fill_names(rows, names, key):
    """Put names on the rows: the database's, and Steam's for a player it has none for."""
    new = {r["steam_id"] for r in rows} - set(names)
    if new and key:
        names.update(cc.resolve_names(key, new))
    cc.fill_names([rows], names)


async def watch(memory):
    w = daily.Watch(memory.dailies, memory.daily_boards)
    names = {sid: dict(v) for sid, v in memory.names.items()}
    key = cc.load_key()
    while True:
        started = time.monotonic()
        reads = await collect_dailies(client, w.known, set(), daily.watch_since(datetime.now(UTC)))
        fresh = w.to_write(reads)
        if fresh:
            for r in fresh:
                await asyncio.to_thread(fill_names, r.rows, names, key)
            rid = await asyncio.to_thread(
                db_writer.record_refresh,
                db_writer.Refresh(
                    started_at=datetime.now(UTC), dailies=tuple(fresh), source="daily"
                ),
                scratch=DEV,
            )
            # a failed write is tried again by the next read, which still sees the change
            if rid is not None:
                w.wrote(fresh)
        await asyncio.sleep(max(0.0, DAILY_EVERY - (time.monotonic() - started)))


@client.event
async def on_ready():
    # steam.py calls this again after it reconnects: the first call's loop goes on
    if _state["started"]:
        return
    _state["started"] = True
    try:
        await watch(_state["memory"])
    except Exception:
        traceback.print_exc()
    finally:
        await client.close()


def main():
    token = cc.load_refresh_token()
    if not token:
        print("ERROR: STEAM_REFRESH_TOKEN not set. Mint one with tools/steampy_mint.py.")
        return 2
    _state["memory"] = db_writer.load_memory(scratch=DEV)
    if _state["memory"] is None:
        return 1
    try:
        client.run(refresh_token=token)
    except Exception as e:
        print(f"ERROR: Steam login/run failed: {e!r}")
    # it only ever stops on an error: Steam closed the session, or a read raised
    return 1


if __name__ == "__main__":
    sys.exit(main())
