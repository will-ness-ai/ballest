"""
Ballest campaign leaderboard collector — HEADLESS (GitHub Actions path).

Logs into Steam with a refresh token (no Steam client, no password at runtime),
reads every campaign leaderboard over the Steam CM via steam.py, resolves player
names via the Steam Web API, and writes data/index.json + data/boards/*.json.
It also keeps the Workshop Maps' boards current (data/workshop.json +
data/workshop/*.json), reading only the ones played since the last run
(collect_workshop), and reads the Dailies the developers' API names (collect_dailies),
which are database-only. Then the same Refresh goes into the database
(db_writer.record_refresh): DATABASE_URL, or with --out only DEV_DATABASE_URL;
skipped when unset.

Auth (secrets, provided as env vars in CI; locally they fall back to the files
steampy_mint.py and .env hold, in this checkout or the main one if this is a
worktree):
  STEAM_REFRESH_TOKEN  — minted once locally with steampy_mint.py
  STEAM_API_KEY        — Steam Web API key (name resolution)
  BALLEST_API_KEY, BALLEST_DAILY_URL — the developers' API, which names each Daily's
                         board (the URL is a prefix the date is appended to); the Daily
                         step is skipped without them. Never printed.

Run locally to test:  python tools/steampy_collect.py
From a feature branch: python tools/steampy_collect.py --workshop-only
  (reads and writes only the Workshop files, then rebuilds the player shards from
  them and the committed Circuit boards; the Circuit boards are CI-owned and stay
  as committed)
To try the whole write path without touching data/:
  python tools/steampy_collect.py --out scratch/data
  python tools/check_data.py --data scratch/data
  (--out copies the committed data/ into that folder, then reads and writes there)
Requires: steamio, aiohttp<3.13, psycopg  (see tools/requirements-steampy.txt)
"""

import asyncio
import logging
import os
import shutil
import sys
import time
import traceback
from datetime import UTC, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import warnings

import campaign_common as cc
import daily
import db_writer

warnings.filterwarnings("ignore")  # silence steam.py's XML-as-HTML parser warning

import steam  # noqa: E402 (after the warnings filter)
from steampy_common import board_rows, fetch_board, find_map_board_id  # noqa: E402

logging.basicConfig(level=logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.CRITICAL)  # hush benign teardown noise

TOKEN = cc.load_refresh_token()
WORKSHOP_ONLY = "--workshop-only" in sys.argv[1:]
STARTED_AT = datetime.now(UTC)
OUT = None
if "--out" in sys.argv[1:]:
    OUT = sys.argv[sys.argv.index("--out") + 1]
    # a fresh copy each run, so it starts from exactly what is committed
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.copytree(cc.DATA_DIR, OUT)
    cc.use_data_dir(OUT)
    print(f"Reading and writing {cc.DATA_DIR}, a copy of data/")

client = steam.Client()
_state = {"done": False, "error": None, "wrote": False, "catalogue": None}


WORKSHOP_GIVE_UP = 10


async def collect_workshop(catalogue, all_ids):
    """Bring the Workshop Maps' boards up to date. Returns what write_site takes as
    `workshop`, or None to leave every committed Workshop file as it is.

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

    A Map's stored counters are the ones seen at its last successful read. A read
    that fails leaves them behind, so the next run tries that Map again, and the
    board keeps its committed file meanwhile. After WORKSHOP_GIVE_UP failures in a
    row the step stops reading: Steam is refusing, and every Map left is tried
    again next run."""
    prev_doc = cc.load_workshop() or {}
    prev = {m["pfid"]: m for m in prev_doc.get("maps", [])}
    if prev and len(catalogue) < cc.WORKSHOP_SHRINK_LIMIT * len(prev):
        print(
            f"  [warn] Workshop catalogue shrank from {len(prev)} to {len(catalogue)} Maps; "
            f"keeping the committed Workshop files"
        )
        return None
    now = int(time.time())
    full = now - int(prev_doc.get("full_sweep_at") or 0) >= cc.FULL_SWEEP_SECONDS
    maps, boards, finds, reads, failed, streak = [], {}, 0, 0, [], 0
    for c in catalogue:
        p = prev.get(c["pfid"], {})
        m = {
            "name": "Workshop_" + c["pfid"],
            "pfid": c["pfid"],
            "display": c["title"],
            "creator": c["creator"],
            "cid": c["cid"],
            "preview": c["preview"],
            "created": c["created"],
            "medals": c["medals"],
            "handle": p.get("handle"),
            "entry_count": p.get("entry_count", 0),
            "rows": p.get("rows", 0),
            "file": p.get("file"),
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
                    m.update(
                        entry_count=int(total or len(rows)),
                        rows=len(rows),
                        file="workshop/" + c["pfid"] + ".json",
                    )
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
        # what the database records as failed reads (db_writer); not written to the JSON
        "failed": failed,
        # a sweep cut short is not a sweep: the next run starts another
        "full_sweep_at": now
        if full and streak < WORKSHOP_GIVE_UP
        else prev_doc.get("full_sweep_at"),
    }


# Seconds between two calls to the developers' API: 60 a minute at most, well under the
# API's limit. Only the first run's catch-up (one call per Daily since
# FIRST_DAILY) makes more than a couple.
DAILY_API_PACE = 1.0


async def collect_dailies(all_ids):
    """Read the Dailies that are due (daily.plan): a list of daily.DailyRead for
    db_writer, each with its rows or None for a read that failed. Returns [] when the step
    is skipped: no API secrets, or no database to learn the known Dailies from and write
    them to (they are database-only).

    The due Dailies the database holds are read first, then each Daily it doesn't hold is
    looked up, paced by DAILY_API_PACE, and read; a lookup that fails, or a date with no
    Daily, is tried again next run. The whole step stops at daily.BUDGET with what it has
    read (daily.collect), so it never holds up the Circuit and Workshop write. It never
    prints the key or the URL."""
    url, key = cc.load_secret("BALLEST_DAILY_URL"), cc.load_secret("BALLEST_API_KEY")
    if not (url and key):
        print("Daily: no BALLEST_API_KEY/BALLEST_DAILY_URL; skipping the Daily step")
        return []
    known = await asyncio.to_thread(db_writer.load_dailies, scratch=OUT is not None)
    if known is None:
        print("Daily: no database to write Dailies to; skipping the Daily step")
        return []
    now = datetime.now(UTC)
    lookups, reads = daily.plan(known, now)

    async def look_up(d):
        return await asyncio.to_thread(daily.look_up, url, key, d)

    async def read(d):
        total, rows = None, None
        try:
            total, entries = await fetch_board(client, int(d.leaderboard_id))
            rows = board_rows(entries)
        except Exception as e:
            print(f"  [warn] Daily {d.date} {d.title!r}: read failed: {e!r}")
        return daily.DailyRead(
            daily=d,
            rows=rows,
            read_at=datetime.now(UTC),
            entry_count=int(total) if total else None,
        )

    out, missing, _ = await daily.collect(
        lookups, reads, now, look_up=look_up, read=read, pace=DAILY_API_PACE
    )
    # only the reads handed on: one abandoned at the budget adds no player
    for r in out:
        all_ids.update(x["steam_id"] for x in r.rows or [])
    ok = sum(1 for r in out if r.ok)
    print(
        f"  Daily: {len(lookups)} looked up ({len(missing)} with no Daily), "
        f"{len(out)} read, {len(out) - ok} failed or empty"
    )
    return out


async def workshop_only():
    """--workshop-only: the Workshop step alone, with its own name lookup. The player
    shards carry Workshop times, so they are rebuilt too, from the committed Circuit
    boards and the Map files just written, as write_site would."""
    if not _state["catalogue"]:
        _state["error"] = RuntimeError("Workshop catalogue unavailable")
        return
    all_ids = set()
    workshop = await collect_workshop(_state["catalogue"], all_ids)
    if workshop is None:
        _state["error"] = RuntimeError("Workshop step declined to write")
        return
    names = cc.name_rows(list(workshop["boards"].values()), all_ids)
    cc.write_workshop(workshop, names)
    _, artifacts = cc.derive(cc.committed_boards(), cc.workshop_boards())
    cc.write_derived(artifacts)
    _state["wrote"] = True
    print("Database: --workshop-only writes no Refresh; skipping the database write")


@client.event
async def on_ready():
    if _state["done"]:
        return
    _state["done"] = True
    try:
        if WORKSHOP_ONLY:
            await workshop_only()
            return
        boards_out = []
        all_ids = set()
        reused = []  # boards whose live read failed but kept last-good data
        hard_failed = []  # boards that failed AND had no previous data to fall back on
        for name, group in cc.BOARDS:
            lid = cc.LEADERBOARD_IDS.get(name)
            if not lid:
                print(f"  [skip] no leaderboard ID for {name}")
                continue
            try:
                total, entries = await fetch_board(client, lid)
                rows = board_rows(entries)
                all_ids.update(r["steam_id"] for r in rows)
                boards_out.append(
                    {
                        "name": name,
                        "display": cc.display_name(name),
                        "group": group,
                        "tier": cc.track_tier(name),
                        "handle": str(lid),
                        "entry_count": int(total or len(rows)),
                        "rows": rows,
                    }
                )
                print(f"  {name:34s} total={int(total):6d} pulled={len(rows)}")
            except Exception as e:
                # Don't overwrite good committed data with an empty board. Reuse the
                # previous file if we have one; otherwise flag a hard failure.
                prev = cc.load_existing_board(name)
                if prev and prev.get("rows"):
                    for r in prev["rows"]:
                        all_ids.add(r["steam_id"])
                    boards_out.append(
                        {
                            "name": name,
                            "display": cc.display_name(name),
                            "group": group,
                            "tier": cc.track_tier(name),
                            "handle": str(lid),
                            "entry_count": int(prev.get("entry_count") or len(prev["rows"])),
                            "rows": prev["rows"],
                        }
                    )
                    reused.append(name)
                    print(
                        f"  [warn] read failed: {name}: {e!r} — "
                        f"reusing {len(prev['rows'])} prior rows"
                    )
                else:
                    hard_failed.append(name)
                    print(f"  [error] read failed and no prior data: {name}: {e!r}")

        # Refuse to publish a wiped/degraded dataset: if any board has no data at
        # all, leave the committed files untouched and fail the run so CI flags it.
        if hard_failed:
            _state["error"] = RuntimeError(f"boards with no data and no prior copy: {hard_failed}")
            print(f"ERROR: {len(hard_failed)} board(s) unreadable with no fallback; not writing.")
            return
        if not any(b["rows"] for b in boards_out):
            _state["error"] = RuntimeError("no board data collected")
            print("ERROR: no board data collected; not writing.")
            return

        workshop = None
        if _state["catalogue"]:
            try:
                workshop = await collect_workshop(_state["catalogue"], all_ids)
            except Exception as e:
                # The campaign still publishes; the Workshop files stay as committed.
                print(f"  [warn] Workshop step failed: {e!r}")
        dailies = []
        try:
            dailies = await collect_dailies(all_ids)
        except Exception as e:
            # Never blocks the Circuit or the Workshop: no Daily counts as read.
            print(f"  [warn] Daily step failed: {type(e).__name__}")
        published, names = cc.write_site(boards_out, all_ids, workshop)
        _state["wrote"] = True
        # The Dailies' players are in all_ids, so the one lookup above named them too.
        cc.fill_names([r.rows for r in dailies if r.ok], names)
        if reused:
            print(f"NOTE: reused previous data for {len(reused)} board(s): {reused}")
        # The same Refresh into the database, after the JSON and never instead of it:
        # record_refresh logs its own failure and does not raise. Only the Workshop the
        # JSON published counts as read, so the two agree (tools/check_db.py).
        await asyncio.to_thread(
            db_writer.record_refresh,
            db_writer.Refresh(
                started_at=STARTED_AT,
                boards=boards_out,
                reused=tuple(reused),
                workshop=published,
                dailies=tuple(dailies),
            ),
            scratch=OUT is not None,
        )
    except Exception as e:
        _state["error"] = e
        traceback.print_exc()
    finally:
        await client.close()


def main():
    if not TOKEN:
        print("ERROR: STEAM_REFRESH_TOKEN not set. Mint one with tools/steampy_mint.py.")
        return 2
    # The Workshop catalogue is plain Web API, so it is fetched before logging in.
    key = cc.load_key()
    if key:
        try:
            _state["catalogue"] = cc.workshop_catalogue(key)
        except Exception as e:
            print(
                f"  [warn] Workshop catalogue unavailable: {e!r}; Workshop files stay as committed"
            )
    try:
        client.run(refresh_token=TOKEN)
    except Exception as e:
        # steam.py commonly raises a ConnectionClosed/ExceptionGroup during the
        # session teardown that follows client.close(). If the data was already
        # written, that teardown noise is not a failure.
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
