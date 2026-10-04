"""
The steam.py leaderboard requests the headless tools share: reading a board by ID, and
finding a board's ID from its name.

Used by steampy_collect.py (CI). It goes through
the logged-in client's websocket directly: steam.py's own leaderboard calls fail for this
app (see find_board_id). Send these one at a time. With several in flight, the CM
silently drops replies.
"""

import campaign_common as cc
import steam
from steam.protobufs import leaderboards


async def fetch_board(client, lid):
    """Read a leaderboard's ENTIRE entry list directly by ID (LBSGetLBEntries).
    Returns (entry_count, entries). Pages defensively in case a board ever
    exceeds a server-side per-request cap (none observed at ~3000)."""
    total = None
    entries = []
    start = 1
    while True:
        msg = await client._state.ws.send_proto_and_wait(  # noqa: SLF001 (steam.py has no public raw-protobuf call)
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


def _ugc(val):
    try:
        n = int(val)
    except (TypeError, ValueError):
        return "0"
    return str(n)


def board_rows(entries):
    """The site's row shape for a board's entries, names left for write_site to fill."""
    return [
        {
            "rank": e.global_rank,
            "steam_id": str(e.steam_id_user),
            "score_ms": int(e.score),
            "time": cc.fmt_time(e.score),
            "ugc_id": _ugc(e.ugc_id),
        }
        for e in entries
    ]


async def find_board_id(client, name):
    """Leaderboard name -> id, or 0 if the board doesn't exist (a map nobody has finished).

    steam.py's own fetch_leaderboard() fails with InvalidParameter for this app because
    it leaves the message header's routing_app_id unset; the CM only resolves a name
    when the request is routed under the app, as the game's SDK session does."""
    msg = leaderboards.CMsgClientLbsFindOrCreateLb(
        app_id=cc.APP_ID, leaderboard_name=name, create_if_not_found=False
    )
    msg.header.routing_app_id = cc.APP_ID
    resp = await client._state.ws.send_proto_and_wait(msg)  # noqa: SLF001 (steam.py has no public raw-protobuf call)
    if resp.result != steam.Result.OK:
        raise RuntimeError(f"LBSFindOrCreateLB result={resp.result!r}")
    return int(resp.leaderboard_id)


async def find_map_board_id(client, board):
    """A map's board id, or 0 if nobody has finished it.

    The Workshop metadata's leaderboard name carries the display name whitespace-trimmed,
    but the game names the board from the untrimmed name in the map file, so a title
    typed with a leading or trailing space (seen once: " dfgzdfgg", pfid 3794947252)
    resolves only with the space put back. Try those before calling a map unbeaten."""
    lid = await find_board_id(client, board)
    if lid:
        return lid
    prefix, sep, name = board.partition("_Climb_")
    if sep:
        for cand in (f"{prefix}{sep} {name}", f"{prefix}{sep}{name} "):
            lid = await find_board_id(client, cand)
            if lid:
                return lid
    return 0
