"""
Ballest campaign leaderboard collector — HEADLESS (GitHub Actions path).

Logs into Steam with a refresh token (no Steam client, no password at runtime),
reads every campaign leaderboard over the Steam CM via steam.py, resolves player
names via the Steam Web API, and writes data/index.json + data/boards/*.json.
It also keeps the Workshop Maps' boards current (data/workshop.json +
data/workshop/*.json), reading only the ones played since the last run
(collect_workshop).

Auth (secrets, provided as env vars in CI; locally they fall back to the files
steampy_mint.py and .env hold, in this checkout or the main one if this is a
worktree):
  STEAM_REFRESH_TOKEN  — minted once locally with steampy_mint.py
  STEAM_API_KEY        — Steam Web API key (name resolution)

Run locally to test:  python tools/steampy_collect.py
From a feature branch: python tools/steampy_collect.py --workshop-only
  (reads and writes only the Workshop files, then rebuilds the player shards from
  them and the committed Circuit boards; the Circuit boards are CI-owned and stay
  as committed)
To try the whole write path without touching data/:
  python tools/steampy_collect.py --out scratch/data
  python tools/check_data.py --data scratch/data
  (--out copies the committed data/ into that folder, then reads and writes there)
Requires: steamio, aiohttp<3.13  (see tools/requirements-steampy.txt)
"""
import os, sys, time, asyncio, logging

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc

import warnings
warnings.filterwarnings("ignore")  # silence steam.py's XML-as-HTML parser warning

import steam
from steampy_common import fetch_board, board_rows, find_map_board_id

logging.basicConfig(level=logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.CRITICAL)  # hush benign teardown noise

TOKEN = cc.load_refresh_token()
WORKSHOP_ONLY = "--workshop-only" in sys.argv[1:]
if "--out" in sys.argv[1:]:
    import shutil
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
    since the last read: a first finish subscribes to the Map, and the session count
    catches most players improving their own time, a few hours late. Nothing moves
    for the rest, so every board is read once every FULL_SWEEP_SECONDS as well.
    Measured 2026-09-28: 96% of board changes came with a counter move.

    A Map's stored counters are the ones seen at its last successful read. A read
    that fails leaves them behind, so the next run tries that Map again, and the
    board keeps its committed file meanwhile. After WORKSHOP_GIVE_UP failures in a
    row the step stops reading: Steam is refusing, and every Map left is tried
    again next run."""
    prev_doc = cc.load_workshop() or {}
    prev = {m["pfid"]: m for m in prev_doc.get("maps", [])}
    if prev and len(catalogue) < cc.WORKSHOP_SHRINK_LIMIT * len(prev):
        print(f"  [warn] Workshop catalogue shrank from {len(prev)} to {len(catalogue)} Maps; "
              f"keeping the committed Workshop files")
        return None
    now = int(time.time())
    full = now - int(prev_doc.get("full_sweep_at") or 0) >= cc.FULL_SWEEP_SECONDS
    maps, boards, finds, reads, failed, streak = [], {}, 0, 0, [], 0
    for c in catalogue:
        p = prev.get(c["pfid"], {})
        m = {"name": "Workshop_" + c["pfid"], "pfid": c["pfid"], "display": c["title"],
             "creator": c["creator"], "cid": c["cid"], "preview": c["preview"],
             "created": c["created"], "medals": c["medals"],
             "handle": p.get("handle"), "entry_count": p.get("entry_count", 0),
             "rows": p.get("rows", 0), "file": p.get("file"),
             "sessions": p.get("sessions"), "subs": p.get("subs")}
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
                    raise RuntimeError("board came back empty")
                if rows:
                    boards[c["pfid"]] = rows
                    all_ids.update(r["steam_id"] for r in rows)
                    m.update(entry_count=int(total or len(rows)), rows=len(rows),
                             file="workshop/" + c["pfid"] + ".json")
        except Exception as e:
            failed.append(c["pfid"])
            print(f"  [warn] Workshop Map {c['pfid']} {c['title']!r}: {e!r}")
            streak += 1
            if streak == WORKSHOP_GIVE_UP:
                print(f"  [warn] {streak} Workshop failures in a row; leaving the rest for next run")
            continue
        streak = 0
        m["sessions"], m["subs"] = c["sessions"], c["subs"]
    print(f"  Workshop: {len(maps)} Maps, {'full sweep' if full else 'played since last run'}: "
          f"{reads} boards read, {finds} looked up, {len(failed)} failed")
    return {"maps": maps, "boards": boards,
            # a sweep cut short is not a sweep: the next run starts another
            "full_sweep_at": now if full and streak < WORKSHOP_GIVE_UP else prev_doc.get("full_sweep_at")}


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
        reused = []       # boards whose live read failed but kept last-good data
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
                boards_out.append({
                    "name": name, "display": cc.display_name(name), "group": group,
                    "tier": cc.track_tier(name),
                    "handle": str(lid), "entry_count": int(total or len(rows)), "rows": rows,
                })
                print(f"  {name:34s} total={int(total):6d} pulled={len(rows)}")
            except Exception as e:
                # Don't overwrite good committed data with an empty board. Reuse the
                # previous file if we have one; otherwise flag a hard failure.
                prev = cc.load_existing_board(name)
                if prev and prev.get("rows"):
                    for r in prev["rows"]:
                        all_ids.add(r["steam_id"])
                    boards_out.append({
                        "name": name, "display": cc.display_name(name), "group": group,
                    "tier": cc.track_tier(name),
                        "handle": str(lid),
                        "entry_count": int(prev.get("entry_count") or len(prev["rows"])),
                        "rows": prev["rows"],
                    })
                    reused.append(name)
                    print(f"  [warn] read failed: {name}: {e!r} — reusing {len(prev['rows'])} prior rows")
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
        cc.write_site(boards_out, all_ids, workshop)
        _state["wrote"] = True
        if reused:
            print(f"NOTE: reused previous data for {len(reused)} board(s): {reused}")
    except Exception as e:
        _state["error"] = e
        import traceback
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
            print(f"  [warn] Workshop catalogue unavailable: {e!r}; Workshop files stay as committed")
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
