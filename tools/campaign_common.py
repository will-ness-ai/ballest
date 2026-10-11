"""
Shared constants + helpers for the Ballest campaign leaderboard collectors.

Used by:
  - steampy_collect.py  (headless, refresh-token login — the CI path)
  - steampy_mint.py     (one-time interactive token mint + validation)
  - db_writer.py, db_backfill.py, ghosts.py (the database the site reads)

Pure stdlib so it imports under any Python the collectors run on.
"""

import contextlib
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request

APP_ID = 3339810
# Steam returns an entire board in one LBSGetLBEntries call at these sizes
# (tested: a single 1..100000 request returned all ~3000 entries). The collector
# still pages defensively in case a board ever exceeds a server-side cap.
FETCH_WINDOW = 100000

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)


# Leaderboard names = level asset names, verbatim (discovered by probing the pak).
# LIST ORDER IS THE IN-GAME NUMBERING: the game labels Circuit tracks only "01".."NN"
# per season, and a track's 1-based position here is that number. Verified 2026-09-07
# against every track's in-game leaderboard. Reordering a list renumbers the site.
S1_TRACKS = [
    "Map_Track13",
    "Map_Track15",
    "Map_Track16",
    "Map_Track05",
    "Map_Track18",
    "Map_Track21",
    "Map_Track22",
    "Map_Track19",
]
S2_TRACKS = [
    "Map_Track_S2_Sampler",
    "Map_Track_S2_Longhaul",
    "Map_Track_S2_Pyramids",
    "Map_Track_S2_BigStairs",
    "Map_Track_S2_Checkerboard",
    "Map_Track_S2_Loopworks",
    "Map_Track_S2_TinyTower",
    "Map_Track_S2_Downhill",
    "Map_Track_S2_NightCondo",
    "Map_Track_S2_NightVents",
    "Map_Track_S2_NightWay",
    "Map_Track_S2_NightClimb",
]

# Steam leaderboard IDs, keyed by name. steam.py's find-by-name (LBSFindOrCreateLB)
# returns InvalidParameter for this app unless the message header's routing_app_id
# is set to the app (see find_board_id in steampy_common.py); the collector
# predates that finding and reads entries directly by ID (LBSGetLBEntries), which
# works. These IDs are stable for the campaign boards.
# To add a board: add it to BOARDS below AND its ID here. (Get a new ID from the
# SDK collector's output, or from the boards table's leaderboard_id once it is read.)
LEADERBOARD_IDS = {
    "OverallLeaderboard": 17800972,
    "Map_Track13": 17800617,
    "Map_Track15": 17800873,
    "Map_Track16": 17800874,
    "Map_Track05": 17800870,
    "Map_Track18": 17800878,
    "Map_Track21": 17800881,
    "Map_Track22": 17800887,
    "Map_Track19": 17800880,
    "OverallLeaderboard_EASeason2": 20484546,
    "Map_Track_S2_Sampler": 20687737,
    "Map_Track_S2_Longhaul": 20687727,
    "Map_Track_S2_Pyramids": 20687736,
    "Map_Track_S2_BigStairs": 20687722,
    "Map_Track_S2_Checkerboard": 20687725,
    "Map_Track_S2_Loopworks": 20687729,
    "Map_Track_S2_TinyTower": 20687738,
    "Map_Track_S2_Downhill": 20687726,
    "Map_Track_S2_NightCondo": 20687732,
    "Map_Track_S2_NightVents": 20687734,
    "Map_Track_S2_NightWay": 20687735,
    "Map_Track_S2_NightClimb": 20687731,
    "Map_TheTower": 17990402,
}

# (leaderboard_name, group) — order here is the order shown in the site's dropdown.
BOARDS = (
    [("OverallLeaderboard", "Season 1")]
    + [(t, "Season 1") for t in S1_TRACKS]
    + [("OverallLeaderboard_EASeason2", "Season 2")]
    + [(t, "Season 2") for t in S2_TRACKS]
    + []
)
# Map_TheTower is parked, not deleted: it reports an internal metric rather than
# run times, so the site never had anything trustworthy to show. Its ID is kept
# above so it can be put back by re-adding it to BOARDS.

# Workshop Maps (collect_workshop in steampy_collect.py).
# Every Map's board is read at least this often, whatever the Workshop counters say:
# nothing on the Workshop moves when a player beats their own time.
FULL_SWEEP_SECONDS = 24 * 3600
# A catalogue this much smaller than the last one is a broken read, not mass deletion.
WORKSHOP_SHRINK_LIMIT = 0.9


def track_number(name):
    """1-based in-game number of a Circuit track, or None for any other board."""
    for tracks in (S1_TRACKS, S2_TRACKS):
        if name in tracks:
            return tracks.index(name) + 1
    return None


# Season 2's track-selection screen groups tracks in rows of four under these
# headings. Season 1's shows no headings at all.
S2_TIERS = ("Beginner", "Intermediate", "Advanced")


def track_tier(name):
    """The in-game difficulty heading a track sits under, or None if there is none."""
    if name in S2_TRACKS:
        return S2_TIERS[min(S2_TRACKS.index(name) // 4, len(S2_TIERS) - 1)]
    return None


def display_name(name):
    """What the site calls a board: the in-game track number, then a nickname.

    Players know Circuit tracks only by the "01".."12" the game shows, so the
    number leads. Season 2 keeps its asset nickname after the number (Sampler,
    Night Condo) because those are memorable; Season 1's asset names are just
    *other* numbers (Map_Track13 is in-game 01) and only confuse, so those are
    the number alone. The season is carried by the "group" field, not repeated.
    """
    if name == "OverallLeaderboard_EASeason2":
        return "Overall"
    if name == "OverallLeaderboard":
        return "Final"
    if name == "Map_TheTower":
        return "The Tower"
    n = track_number(name)
    if name.startswith("Map_Track_S2_"):
        nick = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name[len("Map_Track_S2_") :])
        return f"{n:02d} {nick}"
    if n is not None:
        return f"{n:02d}"
    return name


# Track and UGC boards store a run time as hundred-thousandths of a second, NOT
# milliseconds: seconds = raw_score / 100000. Confirmed against the medal times
# each Workshop map publishes (every world record lands faster than its map's
# author medal only under this unit) and against board shape — Map_Track13 reads
# 0:10.267 / 0:12.541 / 1:46 for best / median / worst, versus a nonsensical
# 17:06 / 20:54 / 2:57:00 if the score were milliseconds.
# Overall* boards are unaffected: those are points, not times.
SCORE_TICKS_PER_SECOND = 100000


def fmt_time(score):
    """Format a raw track/UGC score as m:ss.mmm (h:mm:ss.mmm past an hour)."""
    ms = abs(int(score)) * 1000 // SCORE_TICKS_PER_SECOND
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, msec = divmod(rem, 1000)
    return (f"{h}:{m:02d}" if h else f"{m}") + f":{s:02d}.{msec:03d}"


def secret_roots():
    """Where gitignored secrets (.env, tools/refresh_token.txt) may live: this
    checkout first, then the main checkout when this is a git worktree. Secrets
    are minted once into the main checkout and worktrees never see them, so a
    collector run from a worktree used to come back with every name blank."""
    roots = [PROJ]
    # no git, or not a checkout: this checkout is the only root
    with contextlib.suppress(OSError, subprocess.SubprocessError):
        common = subprocess.run(
            ["git", "rev-parse", "--git-common-dir"],  # noqa: S607 (git from PATH)
            cwd=PROJ,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        ).stdout.strip()
        if common:
            main = os.path.dirname(os.path.abspath(os.path.join(PROJ, common)))
            if main != PROJ:
                roots.append(main)
    return roots


def load_secret(name):
    """A secret: env `name` first (CI), then a NAME= line in a .env file."""
    val = os.environ.get(name, "").strip()
    if val:
        return val
    for root in secret_roots():
        env_path = os.path.join(root, ".env")
        if os.path.exists(env_path):
            with open(env_path, encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if line.startswith(name + "=") and not line.startswith("#"):
                        return line.split("=", 1)[1].strip()
    return ""


def load_key():
    """Steam Web API key: env STEAM_API_KEY first (CI), then a .env file."""
    return load_secret("STEAM_API_KEY")


def load_refresh_token():
    """Steam refresh token: env STEAM_REFRESH_TOKEN first (CI), then the file
    steampy_mint.py saved (tools/refresh_token.txt, gitignored)."""
    token = os.environ.get("STEAM_REFRESH_TOKEN", "").strip()
    if token:
        return token
    for root in secret_roots():
        path = os.path.join(root, "tools", "refresh_token.txt")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return f.read().strip()
    return ""


def resolve_names(key, ids):
    """SteamID64 -> {persona, avatar, profileurl} via GetPlayerSummaries (100 per call)."""
    out = {}
    ids = list(ids)
    if not key:
        return out
    for i in range(0, len(ids), 100):
        chunk = ids[i : i + 100]
        url = (
            "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key="
            + urllib.parse.quote(key)
            + "&steamids="
            + ",".join(chunk)
        )
        try:
            with urllib.request.urlopen(url, timeout=30) as r:  # noqa: S310 (a fixed https URL)
                data = json.load(r)
            for p in data.get("response", {}).get("players", []):
                out[p["steamid"]] = {
                    "persona": p.get("personaname", ""),
                    "avatar": p.get("avatarmedium", ""),
                    "profileurl": p.get("profileurl", ""),
                }
        except Exception as e:
            print(f"  name-resolve chunk failed: {e!r}")
        time.sleep(0.3)
    return out


# Names are carried forward from the database's players rather than looked up
# every run (13k players is 131 GetPlayerSummaries calls). A run looks up players it
# has no name for, plus one slice of everyone else: slices rotate every three hours,
# so every name is refreshed about once a week.
NAME_REFRESH_SLICES = 56


def names_due(ids, known, now=None):
    """The IDs this run looks up: every one without a name, plus this run's slice."""
    slot = int(now if now is not None else time.time()) // (3 * 3600) % NAME_REFRESH_SLICES
    return [
        sid
        for sid in ids
        if sid not in known or (sid.isdigit() and int(sid) % NAME_REFRESH_SLICES == slot)
    ]


def workshop_catalogue(key):
    """Every published Workshop Map, from IPublishedFileService/QueryFiles.

    The game records each Map's Steam leaderboard name in the item's metadata
    (ballest_v0_<pfid>_Climb_<title>); key off that, never the Workshop title,
    which a rename changes. lifetime_playtime_sessions and lifetime_subscriptions
    are what tell the collector a Map was played since it last read the board.
    Raises if the pages come back short of the total Steam reports, so a partial
    read can never look like deleted Maps."""
    maps, cursor, seen, fetched, total = [], "*", set(), 0, None
    while True:
        q = urllib.parse.urlencode(
            {
                "key": key,
                "appid": APP_ID,
                "query_type": 1,
                "numperpage": 100,
                "cursor": cursor,
                "return_metadata": 1,
                "return_playtime_stats": 1,
            }
        )
        with urllib.request.urlopen(
            "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?" + q, timeout=60
        ) as r:
            resp = json.load(r)["response"]
        total = int(resp.get("total", 0))
        batch = resp.get("publishedfiledetails") or []
        for it in batch:
            pfid = it.get("publishedfileid")
            if not pfid or pfid in seen:
                continue
            seen.add(pfid)
            fetched += 1
            try:
                b = json.loads(it.get("metadata") or "{}")["ballest"]
                board = b["leaderboard_name_current"]
                medals = [float(t) for t in b["medal_times_by_index"]]
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                print(f"  [skip] Map {pfid} {it.get('title')!r}: no usable ballest metadata")
                continue
            maps.append(
                {
                    "pfid": pfid,
                    "title": it.get("title") or b.get("level_display_name") or pfid,
                    "creator": b.get("creator_name", ""),
                    "created": int(it.get("time_created") or 0),
                    "medals": medals,
                    "board": board,
                    "cid": str(it.get("creator") or ""),
                    "preview": it.get("preview_url") or "",
                    "sessions": int(it.get("lifetime_playtime_sessions") or 0),
                    "subs": int(it.get("lifetime_subscriptions") or 0),
                }
            )
        nxt = resp.get("next_cursor")
        if not batch or not nxt or nxt == cursor:
            break
        cursor = nxt
        time.sleep(0.3)
    if fetched < total:
        raise RuntimeError(f"Workshop catalogue came back short: {fetched} of {total} items")
    return maps


def name_rows(row_lists, all_ids, known):
    """Put persona/avatar/profileurl on every row in row_lists, and return the
    SteamID64 -> names map they came from. Names are carried forward from known (the
    players the database holds, db_writer.load_memory); only players without one, plus
    this run's slice (names_due), are looked up."""
    key = load_key()
    if not key:
        print(
            "WARNING: no STEAM_API_KEY (env or .env) — names will be blank (ids still collected)."
        )
    # The slice covers every player we know, not only this run's rows: a Workshop board
    # is re-read only when played, so its players would otherwise rarely come up.
    due = names_due(set(all_ids) | set(known), known)
    print(f"Resolving {len(due)} player names (new, plus this run's slice)...")
    names = {sid: dict(v) for sid, v in known.items()}
    for sid, info in resolve_names(key, due).items():
        cur = names.setdefault(sid, {})
        for field, val in info.items():
            if val:
                cur[field] = val

    fill_names(row_lists, names)
    return names


def fill_names(row_lists, names):
    """Put persona/avatar/profileurl from `names` (what name_rows returned) on every row in
    row_lists."""
    for rows in row_lists:
        for r in rows:
            info = names.get(r["steam_id"], {})
            # Prefer a freshly-resolved value, but keep any existing one if this
            # run's resolution came back empty (e.g. a failed GetPlayerSummaries
            # chunk, or rows reused from a previous run).
            r["persona"] = info.get("persona") or r.get("persona", "")
            r["avatar"] = info.get("avatar") or r.get("avatar", "")
            r["profileurl"] = info.get("profileurl") or r.get("profileurl", "")
