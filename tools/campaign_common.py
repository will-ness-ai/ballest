"""
Shared constants + helpers for the Ballest campaign leaderboard collectors.

Used by:
  - steampy_collect.py  (headless, refresh-token login — the CI path)
  - steampy_mint.py     (one-time interactive token mint + validation)

Pure stdlib so it imports under any Python the collectors run on.
"""
import os, re, time, json, urllib.request, urllib.parse

APP_ID = 3339810
# Steam returns an entire board in one LBSGetLBEntries call at these sizes
# (tested: a single 1..100000 request returned all ~3000 entries). The collector
# still pages defensively in case a board ever exceeds a server-side cap.
FETCH_WINDOW = 100000

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DATA_DIR = os.path.join(PROJ, "data")
BOARDS_DIR = os.path.join(DATA_DIR, "boards")
INDEX_PATH = os.path.join(DATA_DIR, "index.json")
PODIUMS_PATH = os.path.join(DATA_DIR, "podiums.json")

# Leaderboard names = level asset names, verbatim (discovered by probing the pak).
# LIST ORDER IS THE IN-GAME NUMBERING: the game labels Circuit tracks only "01".."NN"
# per season, and a track's 1-based position here is that number. Verified 2026-09-07
# against every track's in-game leaderboard. Reordering a list renumbers the site.
S1_TRACKS = ["Map_Track13", "Map_Track15", "Map_Track16", "Map_Track05",
             "Map_Track18", "Map_Track21", "Map_Track22", "Map_Track19"]
S2_TRACKS = ["Map_Track_S2_Sampler", "Map_Track_S2_Longhaul", "Map_Track_S2_Pyramids",
             "Map_Track_S2_BigStairs", "Map_Track_S2_Checkerboard", "Map_Track_S2_Loopworks",
             "Map_Track_S2_TinyTower", "Map_Track_S2_Downhill", "Map_Track_S2_NightCondo",
             "Map_Track_S2_NightVents", "Map_Track_S2_NightWay", "Map_Track_S2_NightClimb"]

# Steam leaderboard IDs, keyed by name. steam.py's find-by-name (LBSFindOrCreateLB)
# returns InvalidParameter for this app unless the message header's routing_app_id
# is set to the app (see find_board_id in ugc_discord_leaderboard.py); the collector
# predates that finding and reads entries directly by ID (LBSGetLBEntries), which
# works. These IDs are stable for the campaign boards.
# To add a board: add it to BOARDS below AND its ID here. (Get a new ID from the
# SDK collector's output, or from an existing data/campaign.json "handle".)
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
    [("OverallLeaderboard", "Season 1")] +
    [(t, "Season 1") for t in S1_TRACKS] +
    [("OverallLeaderboard_EASeason2", "Season 2")] +
    [(t, "Season 2") for t in S2_TRACKS] +
    []
)
# Map_TheTower is parked, not deleted: it reports an internal metric rather than
# run times, so the site never had anything trustworthy to show. Its ID is kept
# above so it can be put back by re-adding it to BOARDS.



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
    if name in ("OverallLeaderboard", "OverallLeaderboard_EASeason2"):
        return "Overall"
    if name == "Map_TheTower":
        return "The Tower"
    n = track_number(name)
    if name.startswith("Map_Track_S2_"):
        nick = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name[len("Map_Track_S2_"):])
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
    try:
        import subprocess
        common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=PROJ,
                                capture_output=True, text=True, timeout=10).stdout.strip()
        if common:
            main = os.path.dirname(os.path.abspath(os.path.join(PROJ, common)))
            if main != PROJ:
                roots.append(main)
    except Exception:
        pass
    return roots


def load_key():
    """Steam Web API key: env STEAM_API_KEY first (CI), then a .env file."""
    key = os.environ.get("STEAM_API_KEY", "").strip()
    if key:
        return key
    for root in secret_roots():
        env_path = os.path.join(root, ".env")
        if os.path.exists(env_path):
            for line in open(env_path, encoding="utf-8"):
                line = line.strip()
                if line.startswith("STEAM_API_KEY=") and not line.startswith("#"):
                    return line.split("=", 1)[1].strip()
    return ""


def load_refresh_token():
    """Steam refresh token: env STEAM_REFRESH_TOKEN first (CI), then the file
    steampy_mint.py saved (tools/refresh_token.txt, gitignored)."""
    token = os.environ.get("STEAM_REFRESH_TOKEN", "").strip()
    if token:
        return token
    for root in secret_roots():
        path = os.path.join(root, "tools", "refresh_token.txt")
        if os.path.exists(path):
            return open(path, encoding="utf-8").read().strip()
    return ""


def resolve_names(key, ids):
    """SteamID64 -> {persona, avatar, profileurl} via GetPlayerSummaries (100 per call)."""
    out = {}
    ids = list(ids)
    if not key:
        return out
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        url = ("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key="
               + urllib.parse.quote(key) + "&steamids=" + ",".join(chunk))
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                data = json.load(r)
            for p in data.get("response", {}).get("players", []):
                out[p["steamid"]] = {"persona": p.get("personaname", ""),
                                     "avatar": p.get("avatarmedium", ""),
                                     "profileurl": p.get("profileurl", "")}
        except Exception as e:
            print(f"  name-resolve chunk failed: {e!r}")
        time.sleep(0.3)
    return out


def load_existing_board(name):
    """Return the previously-written data/boards/<name>.json (dict), or None.
    Used to keep last-good data for a board whose live read failed this run."""
    path = os.path.join(BOARDS_DIR, name + ".json")
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"  (could not read existing {name}.json: {e!r})")
    return None


def build_podiums(boards_out):
    """Per-season podium tally: who holds the 1st, 2nd and 3rd places across a
    season's tracks. Only Map_* boards count (an Overall board is points, not a
    race), so a season with no track boards is left out entirely.

    Players are sorted by golds, then silvers, then bronzes, and equal counts
    share a rank (1, 2, 2, 4 ...) rather than being split by some fourth key the
    reader can't see. Rows come from boards_out AFTER name resolution, so each
    player carries the same persona/avatar the board files do."""
    seasons = []
    for group in dict.fromkeys(g for _, g in BOARDS):
        tracks = [b for b in boards_out if b["group"] == group and b["name"].startswith("Map_")]
        if not tracks:
            continue
        players = {}
        for b in tracks:
            for r in b["rows"][:3]:    # rows are rank-ordered; the podium is the first three
                p = players.setdefault(r["steam_id"], {
                    "steam_id": r["steam_id"], "persona": r.get("persona", ""),
                    "avatar": r.get("avatar", ""), "profileurl": r.get("profileurl", ""),
                    "gold": 0, "silver": 0, "bronze": 0, "finishes": []})
                p[("gold", "silver", "bronze")[r["rank"] - 1]] += 1
                p["finishes"].append({"track": b["display"], "rank": r["rank"],
                                      "score_ms": r["score_ms"],
                                      "time": fmt_time(r["score_ms"])})
        ordered = sorted(players.values(),
                         key=lambda p: (-p["gold"], -p["silver"], -p["bronze"]))
        prev = None
        for i, p in enumerate(ordered):
            counts = (p["gold"], p["silver"], p["bronze"])
            p["rank"] = i + 1 if counts != prev else ordered[i - 1]["rank"]
            prev = counts
            p["finishes"].sort(key=lambda f: (f["rank"], f["track"]))
        seasons.append({"group": group, "tracks": len(tracks), "players": ordered})
    return seasons


def write_site(boards_out, all_ids):
    """Resolve names, then write one file per board (data/boards/<name>.json) plus
    a small data/index.json the page loads first. Board files omit generated_at so
    an unchanged board produces no diff (only index.json changes every run)."""
    key = load_key()
    if not key:
        print("WARNING: no STEAM_API_KEY (env or .env) — names will be blank (ids still collected).")
    print(f"Resolving {len(all_ids)} player names...")
    names = resolve_names(key, all_ids)

    os.makedirs(BOARDS_DIR, exist_ok=True)
    index_boards = []
    unique = set()
    for b in boards_out:
        for r in b["rows"]:
            info = names.get(r["steam_id"], {})
            # Prefer a freshly-resolved value, but keep any existing one if this
            # run's resolution came back empty (e.g. a failed GetPlayerSummaries
            # chunk, or rows reused from a previous run).
            r["persona"] = info.get("persona") or r.get("persona", "")
            r["avatar"] = info.get("avatar") or r.get("avatar", "")
            r["profileurl"] = info.get("profileurl") or r.get("profileurl", "")
            unique.add(r["steam_id"])
        fname = b["name"] + ".json"
        board_doc = {"name": b["name"], "display": b["display"], "group": b["group"],
                     "handle": b["handle"], "entry_count": b["entry_count"], "rows": b["rows"]}
        with open(os.path.join(BOARDS_DIR, fname), "w", encoding="utf-8") as f:
            json.dump(board_doc, f, ensure_ascii=False, separators=(",", ":"))
        index_boards.append({"name": b["name"], "display": b["display"], "group": b["group"],
                             "tier": b.get("tier"),
                             "handle": b["handle"], "entry_count": b["entry_count"],
                             "rows": len(b["rows"]), "file": "boards/" + fname})

    # The podium tally is derived from the rows above, fallback data included, so
    # it can never disagree with the boards the page shows. Like the board files
    # it omits generated_at so an unchanged season produces no diff. The same
    # never-publish-empty rule as the boards applies: a season with track boards
    # but nobody on a podium can only mean the rows were empty, so the previous
    # file is left in place rather than overwritten with a blank cabinet.
    seasons = build_podiums(boards_out)
    empty = [s["group"] for s in seasons if not s["players"]]
    if not seasons or empty:
        print(f"  [warn] podium tally empty for {empty or 'every season'}; keeping the previous podiums.json")
    else:
        with open(PODIUMS_PATH, "w", encoding="utf-8") as f:
            json.dump({"seasons": seasons}, f, ensure_ascii=False, separators=(",", ":"))
        for s in seasons:
            print(f"  podiums {s['group']:10s} tracks={s['tracks']:2d} players={len(s['players'])}")

    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "app_id": APP_ID, "player_count": len(unique),
                   "boards": index_boards}, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {INDEX_PATH} + {len(boards_out)} board files ({len(unique)} unique players)")
    return INDEX_PATH
