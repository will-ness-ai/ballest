"""
Ballest campaign leaderboard collector — HEADLESS (GitHub Actions path).

Logs into Steam with a refresh token (no Steam client, no password at runtime),
reads every campaign leaderboard over the Steam CM via steam.py, resolves player
names via the Steam Web API, and writes data/index.json + data/boards/*.json.

Auth (secrets, provided as env vars in CI):
  STEAM_REFRESH_TOKEN  — minted once locally with steampy_mint.py
  STEAM_API_KEY        — Steam Web API key (name resolution)

Run locally to test:  python tools/steampy_collect.py
Requires: steamio, aiohttp<3.13  (see tools/requirements-steampy.txt)
"""
import os, sys, asyncio, logging

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc

import warnings
warnings.filterwarnings("ignore")  # silence steam.py's XML-as-HTML parser warning

import steam
from steam.protobufs import leaderboards

logging.basicConfig(level=logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.CRITICAL)  # hush benign teardown noise

TOKEN = os.environ.get("STEAM_REFRESH_TOKEN", "").strip()

client = steam.Client()
_state = {"done": False, "error": None, "wrote": False}


def _ugc(val):
    try:
        n = int(val)
    except (TypeError, ValueError):
        return "0"
    return str(n)


async def fetch_board(lid):
    """Read a leaderboard's ENTIRE entry list directly by ID (LBSGetLBEntries).
    steam.py's find-by-name is broken for this app, so we go straight to the
    entries request with the known ID. Pages defensively in case a board ever
    exceeds a server-side per-request cap (none observed at ~3000)."""
    total = None
    entries = []
    start = 1
    while True:
        msg = await client._state.ws.send_proto_and_wait(
            leaderboards.CMsgClientLbsGetLbEntries(
                leaderboard_id=lid,
                app_id=cc.APP_ID,
                range_start=start,
                range_end=start + cc.FETCH_WINDOW - 1,
                leaderboard_data_request=0,  # Global
                steamids=[],
            )
        )
        if msg.result != steam.Result.OK:
            raise RuntimeError(f"LBSGetLBEntries result={msg.result!r}")
        if total is None:
            total = msg.leaderboard_entry_count
        batch = list(msg.entries)
        entries.extend(batch)
        # Stop when the board is exhausted. Do NOT stop just because a batch was
        # smaller than the window — that would silently truncate a board if the CM
        # ever caps entries-per-request below FETCH_WINDOW; keep paging instead.
        if not batch or len(entries) >= total:
            break
        start = len(entries) + 1
    return total, entries


@client.event
async def on_ready():
    if _state["done"]:
        return
    _state["done"] = True
    try:
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
                total, entries = await fetch_board(lid)
                rows = []
                for e in entries:
                    sid = str(e.steam_id_user)
                    all_ids.add(sid)
                    rows.append({
                        "rank": e.global_rank,
                        "steam_id": sid,
                        "score_ms": int(e.score),
                        "time": cc.fmt_time(e.score),
                        "ugc_id": _ugc(e.ugc_id),
                    })
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

        cc.write_site(boards_out, all_ids)
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
