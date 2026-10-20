"""
Ballest campaign leaderboard collector — HEADLESS (the live path, run by runner.py on Fly).

`refresh(session)` is one Refresh on the service's Steam session (steam_session.py, logged
in with a refresh token: no Steam client, no password at runtime). It
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

Run on its own, it logs in for that one Refresh (refresh.yml's fallback does). Run it so
from a feature branch against a local database, never production:
  DEV_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev \
    python tools/steampy_collect.py --dev
Requires: steamio, aiohttp<3.13, psycopg  (see tools/requirements-steampy.txt)
"""

import asyncio
import os
import sys
import time
from datetime import UTC, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc
import db_writer
import ghosts
import map_files
import steam_session  # first: it silences steam.py's warnings before steampy_common's import
from steampy_common import (
    board_rows,
    collect_dailies,
    fetch_board,
    find_map_board_id,
)

WORKSHOP_GIVE_UP = 10


async def collect_workshop(session, catalogue, all_ids, memory):
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
                lid = await find_map_board_id(session, c["board"])
                m["handle"] = str(lid) if lid else None
            if m["handle"]:
                reads += 1
                total, entries = await fetch_board(session, int(m["handle"]))
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


async def read_circuit(session, all_ids):
    """Every Circuit board: (boards, failed), a failed read's board with no rows."""
    boards_out = []
    failed = []  # boards whose read failed: their Entries stay as they were
    for name, group in cc.BOARDS:
        lid = cc.LEADERBOARD_IDS.get(name)
        if not lid:
            print(f"  [skip] no leaderboard ID for {name}")
            continue
        try:
            total, entries = await fetch_board(session, lid)
            rows = board_rows(entries)
            all_ids.update(r["steam_id"] for r in rows)
            boards_out.append(
                {
                    "name": name,
                    "group": group,
                    "handle": str(lid),
                    "entry_count": int(total or len(rows)),
                    "rows": rows,
                }
            )
            print(f"  {name:34s} total={int(total):6d} pulled={len(rows)}")
        except Exception as e:
            # A failed read changes nothing: the board's Entries stay as the last
            # good read left them (db_writer counts it as a failed read).
            boards_out.append({"name": name, "group": group, "handle": str(lid), "rows": []})
            failed.append(name)
            print(f"  [warn] read failed: {name}: {e!r}")
    return boards_out, failed


async def refresh(session, *, dev=False):
    """One Refresh on the Steam `session`: 0 once it is in the database, else 1 (2 without
    a token). With `dev` it writes only DEV_DATABASE_URL (db_writer.database_url), never
    production. Everything blocking runs in a thread, so the session's other jobs and its
    heartbeat go on meanwhile."""
    if not session.token:
        print("ERROR: STEAM_REFRESH_TOKEN not set. Mint one with tools/steampy_mint.py.")
        return 2
    started_at = datetime.now(UTC)
    memory = await asyncio.to_thread(db_writer.load_memory, scratch=dev)
    if memory is None:
        return 1
    # The Workshop catalogue is plain Web API.
    catalogue = None
    key = cc.load_key()
    if key:
        try:
            catalogue = await asyncio.to_thread(cc.workshop_catalogue, key)
        except Exception as e:
            print(f"  [warn] Workshop catalogue unavailable: {e!r}; no Map is read this run")
    try:
        await session.ready()
    except (ConnectionError, TimeoutError) as e:
        print(f"ERROR: no Steam login ({e!r}); not reading.")
        print("If the token is invalid/expired, re-mint with tools/steampy_mint.py.")
        return 1
    all_ids = set()
    boards_out, failed = await read_circuit(session, all_ids)
    # Refuse a Refresh that read nothing: Steam is down, or this login is broken.
    if not any(b["rows"] for b in boards_out):
        print("ERROR: no board data collected; not writing.")
        return 1

    workshop = None
    if catalogue:
        try:
            workshop = await collect_workshop(session, catalogue, all_ids, memory)
        except Exception as e:
            # The Circuit still writes; no Map counts as read.
            print(f"  [warn] Workshop step failed: {e!r}")
    dailies = []
    try:
        dailies = await collect_dailies(session, memory.dailies, all_ids)
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
    rid = await db_writer.record(
        db_writer.Refresh(
            started_at=started_at,
            boards=boards_out,
            failed=tuple(failed),
            workshop=workshop,
            dailies=tuple(dailies),
        ),
        scratch=dev,
    )
    if rid is None:
        print("ERROR: the database write failed.")
        return 1
    # Each top run's Ghost, for its skin: after the Refresh, so it never holds it up,
    # and never fails the run.
    try:
        await asyncio.to_thread(ghosts.record_ghosts, scratch=dev)
    except Exception as e:
        print(f"::warning::Ghost step failed: {type(e).__name__}")
    # Each Workshop Map's file, new or changed since the last run, for the site's 3D
    # view; never fails the run.
    try:
        await map_files.record_map_files(catalogue, map_files.steam_download(session), scratch=dev)
    except Exception as e:
        print(f"::warning::Map file step failed: {type(e).__name__}")
    return 0


def main():
    """A Refresh on its own: logs in for it and off after. --dev writes DEV_DATABASE_URL."""
    dev = "--dev" in sys.argv[1:]
    code = steam_session.run_alone(lambda session: refresh(session, dev=dev))
    if code == 1:
        print("ERROR: collection did not complete (no data written).")
    return code


if __name__ == "__main__":
    sys.exit(main())
