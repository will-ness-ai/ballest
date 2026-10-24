"""
Ballest campaign leaderboard collector — HEADLESS (the live path, run by runner.py on Fly).

Logs into Steam with a refresh token (no Steam client, no password at runtime),
reads every Circuit leaderboard over the Steam CM via steam.py, keeps the Workshop
Maps' boards current, reading only the ones played since the last run
(collect_workshop), reads the Dailies the developers' API names (collect_dailies),
resolves player names via the Steam Web API, and writes it all to the database as one
Refresh (db_writer.record_refresh). Last, the Ghosts of the top runs are read for their
skins (ghosts.record_ghosts), and the Workshop Maps' new or changed files are downloaded
(map_files.record_map_files), into the same database.

The database is the only place it writes and the only memory it has between runs: each
Map's board ID and Workshop counters, when it last read every Map, and every player's
name are read back from it first (db_writer.load_memory). It writes DATABASE_URL, or with
--dev only DEV_DATABASE_URL, and without one it stops before logging in.

Auth (secrets, provided as env vars on Fly; locally they fall back to the files
steampy_mint.py and .env hold, in this checkout or the main one if this is a
worktree):
  STEAM_REFRESH_TOKEN  — minted once locally with steampy_mint.py
  STEAM_API_KEY        — Steam Web API key (name resolution, Ghosts)
  BALLEST_API_KEY, BALLEST_DAILY_URL — the developers' API, which names each Daily's
                         board (the URL is a prefix the date is appended to); the Daily
                         step is skipped without them. Never printed.

Run it from a feature branch against a local database, never production:
  DEV_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev \
    python tools/steampy_collect.py --dev
Requires: steamio, aiohttp<3.13, psycopg  (see tools/requirements-steampy.txt)
"""

import asyncio
import logging
import os
import sys
import time
import traceback
from datetime import UTC, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import warnings

import campaign_common as cc
import db_writer
import ghosts
import map_files

warnings.filterwarnings("ignore")  # silence steam.py's XML-as-HTML parser warning

import steam  # noqa: E402 (after the warnings filter)
from steampy_common import (  # noqa: E402
    board_rows,
    collect_dailies,
    fetch_board,
    find_map_board_id,
)

logging.basicConfig(level=logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.CRITICAL)  # hush benign teardown noise

TOKEN = cc.load_refresh_token()
# --dev writes only DEV_DATABASE_URL (db_writer.database_url), never production
DEV = "--dev" in sys.argv[1:]
STARTED_AT = datetime.now(UTC)

client = steam.Client()
_state = {"done": False, "error": None, "wrote": False, "catalogue": None, "memory": None}


WORKSHOP_GIVE_UP = 10


async def collect_workshop(catalogue, all_ids, memory):
    """Bring the Workshop Maps' boards up to date. Returns what db_writer.Refresh takes as
    `workshop`, or None to count no Map as read this Refresh.

    Reading every Map's board is one request per Map, one at a time, and Maps arrive
    at ~225 a week. So a board is read only when its Map's Workshop counters moved
    since the last read, and every board once every FULL_SWEEP_SECONDS as well.
    Measured 2026-09-28: 96% of board changes came with a counter move, but on a busy
    Map other players keep the counters moving. A single finish often moves neither:
    a subscription counts when the Map is downloaded, before any finish (all five
    Maps with no runs had 13-28 subscribers on 2026-09-30, and no Map had fewer
    subscribers than runners), and the session count misses plays (353 of 975 Maps
    with runs had fewer sessions than runners, 17 had none). So a first time or a
    better one on a quiet Map can wait for the full read. The refresh dialog
    (web/components/Freshness.tsx) tells players this; keep the two in step.

    A Map's stored counters (memory.maps, from map_history) are the ones seen at its
    last successful read. A read that fails leaves them behind, so the next run tries
    that Map again, and its Entries stay as they were meanwhile. After WORKSHOP_GIVE_UP
    failures in a row the step stops reading: Steam is refusing, and every Map left is
    tried again next run."""
    prev = memory.maps
    if memory.listed and len(catalogue) < cc.WORKSHOP_SHRINK_LIMIT * memory.listed:
        print(
            f"  [warn] Workshop catalogue shrank from {memory.listed} to {len(catalogue)} Maps; "
            f"counting no Map as read"
        )
        return None
    now = int(time.time())
    full = now - memory.full_sweep_at >= cc.FULL_SWEEP_SECONDS
    maps, boards, finds, reads, failed, streak = [], {}, 0, 0, [], 0
    for c in catalogue:
        p = prev.get(c["pfid"], {})
        m = db_writer.workshop_map(c) | {
            "handle": p.get("handle"),
            "entry_count": p.get("entry_count", 0),
            "rows": p.get("rows", 0),
            "sessions": p.get("sessions"),
            "subs": p.get("subs"),
        }
        maps.append(m)
        moved = (m["sessions"], m["subs"]) != (c["sessions"], c["subs"])
        if not (moved or full) or streak >= WORKSHOP_GIVE_UP:
            continue
        try:
            if not m["handle"]:
                # A board appears on a Map's first finish, and its ID never changes.
                finds += 1
                lid = await find_map_board_id(client, c["board"])
                m["handle"] = str(lid) if lid else None
            if m["handle"]:
                reads += 1
                total, entries = await fetch_board(client, int(m["handle"]))
                rows = board_rows(entries)
                if not rows and m["rows"]:
                    raise RuntimeError("board came back empty")  # noqa: TRY301 (to the fallback below)
                if rows:
                    boards[c["pfid"]] = rows
                    all_ids.update(r["steam_id"] for r in rows)
                    m.update(entry_count=int(total or len(rows)), rows=len(rows))
        except Exception as e:
            failed.append(c["pfid"])
            print(f"  [warn] Workshop Map {c['pfid']} {c['title']!r}: {e!r}")
            streak += 1
            if streak == WORKSHOP_GIVE_UP:
                print(
                    f"  [warn] {streak} Workshop failures in a row; leaving the rest for next run"
                )
            continue
        streak = 0
        m["sessions"], m["subs"] = c["sessions"], c["subs"]
    print(
        f"  Workshop: {len(maps)} Maps, {'full sweep' if full else 'played since last run'}: "
        f"{reads} boards read, {finds} looked up, {len(failed)} failed"
    )
    return {
        "maps": maps,
        "boards": boards,
        # what the database records as failed reads (db_writer)
        "failed": failed,
        # a sweep cut short is not a sweep: the next run starts another
        "full_sweep": full and streak < WORKSHOP_GIVE_UP,
    }


@client.event
async def on_ready():
    if _state["done"]:
        return
    _state["done"] = True
    try:
        memory = _state["memory"]
        all_ids = set()

        async def fetch_rows(lid):
            total, entries = await fetch_board(client, lid)
            return total, board_rows(entries)

        circuit = []
        for name, group in cc.BOARDS:
            lid = cc.LEADERBOARD_IDS.get(name)
            if lid:
                circuit.append((name, lid, group))
            else:
                print(f"  [skip] no leaderboard ID for {name}")
        # A failed read changes nothing: the board's Entries stay as the last good read left
        # them (db_writer counts it as a failed read).
        boards_out, failed = await cc.read_boards(fetch_rows, circuit)
        for b in boards_out:
            all_ids.update(r["steam_id"] for r in b["rows"])

        # Refuse a Refresh that read nothing: Steam is down, or this login is broken.
        if not any(b["rows"] for b in boards_out):
            _state["error"] = RuntimeError("no board data collected")
            print("ERROR: no board data collected; not writing.")
            return

        # Each Event board with no good read yet: after the guard, so it never decides the
        # run. A failed or empty read is a failed read (db_writer); the next Refresh retries.
        events, events_failed = await cc.read_events(fetch_rows, memory.events_read)
        for b in events:
            all_ids.update(r["steam_id"] for r in b["rows"])
        boards_out += events
        failed += events_failed

        workshop = None
        if _state["catalogue"]:
            try:
                workshop = await collect_workshop(_state["catalogue"], all_ids, memory)
            except Exception as e:
                # The Circuit still writes; no Map counts as read.
                print(f"  [warn] Workshop step failed: {e!r}")
        dailies = []
        try:
            dailies = await collect_dailies(client, memory.dailies, all_ids)
        except Exception as e:
            # Never blocks the Circuit or the Workshop: no Daily counts as read.
            print(f"  [warn] Daily step failed: {type(e).__name__}")
        # Plain HTTP that sleeps between batches: run it off the event loop, or a big
        # lookup (an empty database: 16k names) starves steam.py's heartbeat and Steam
        # drops the connection mid-run.
        await asyncio.to_thread(
            cc.name_rows,
            [b["rows"] for b in boards_out]
            + list(workshop["boards"].values() if workshop else [])
            + [r.rows for r in dailies if r.ok],
            all_ids,
            memory,
        )
        if failed:
            print(f"NOTE: {len(failed)} board(s) not read, left as they were: {failed}")
        rid = await asyncio.to_thread(
            db_writer.record_refresh,
            db_writer.Refresh(
                started_at=STARTED_AT,
                boards=boards_out,
                failed=tuple(failed),
                workshop=workshop,
                dailies=tuple(dailies),
            ),
            scratch=DEV,
        )
        if rid is None:
            _state["error"] = RuntimeError("the database write failed")
            return
        _state["wrote"] = True
        # Each top run's Ghost, for its skin: after the Refresh, so it never holds it up,
        # and never fails the run.
        try:
            await asyncio.to_thread(ghosts.record_ghosts, scratch=DEV)
        except Exception as e:
            print(f"::warning::Ghost step failed: {type(e).__name__}")
        # Each Workshop Map's file, new or changed since the last run, for the site's 3D
        # view: needs the client, so before it closes; never fails the run.
        try:
            await map_files.record_map_files(
                _state["catalogue"], map_files.steam_download(client), scratch=DEV
            )
        except Exception as e:
            print(f"::warning::Map file step failed: {type(e).__name__}")
    except Exception as e:
        _state["error"] = e
        traceback.print_exc()
    finally:
        await client.close()


def main():
    if not TOKEN:
        print("ERROR: STEAM_REFRESH_TOKEN not set. Mint one with tools/steampy_mint.py.")
        return 2
    _state["memory"] = db_writer.load_memory(scratch=DEV)
    if _state["memory"] is None:
        return 1
    # The Workshop catalogue is plain Web API, so it is fetched before logging in.
    key = cc.load_key()
    if key:
        try:
            _state["catalogue"] = cc.workshop_catalogue(key)
        except Exception as e:
            print(f"  [warn] Workshop catalogue unavailable: {e!r}; no Map is read this run")
    try:
        client.run(refresh_token=TOKEN)
    except Exception as e:
        # steam.py commonly raises a ConnectionClosed/ExceptionGroup during the
        # session teardown that follows client.close(). If the data was already
        # written to the database, that teardown noise is not a failure.
        if _state["wrote"]:
            print("(note: benign Steam session-teardown error after write — ignored)")
        else:
            print(f"ERROR: Steam login/run failed: {e!r}")
            print("If the token is invalid/expired, re-mint with tools/steampy_mint.py.")
            return 1
    if _state["error"] or not _state["wrote"]:
        print("ERROR: collection did not complete (no data written).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
