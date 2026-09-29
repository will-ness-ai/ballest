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
# Everything else under data/ is named by derive(), relative to DATA_DIR.


def use_data_dir(path):
    """Point every read and write in this module at path instead of data/: the
    collector's --out and check_data's --data, so a branch can run and check the
    whole write path against a scratch copy. Call it before anything reads."""
    global DATA_DIR, BOARDS_DIR, INDEX_PATH, WORKSHOP_PATH, WORKSHOP_DIR
    DATA_DIR = os.path.abspath(path)
    BOARDS_DIR = os.path.join(DATA_DIR, "boards")
    INDEX_PATH = os.path.join(DATA_DIR, "index.json")
    WORKSHOP_PATH = os.path.join(DATA_DIR, "workshop.json")
    WORKSHOP_DIR = os.path.join(DATA_DIR, "workshop")

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
# is set to the app (see find_board_id in steampy_common.py); the collector
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

# The one board Steam does not have: every season's Overall points added up per
# player. It is derived by the collector from the Overall* boards above (see
# build_composite), so it has no leaderboard ID and is not in BOARDS. The name
# keeps the Overall prefix on purpose — that prefix is how the site knows a
# board is points rather than run times.
COMPOSITE_BOARD = "OverallLeaderboard_AllSeasons"
COMPOSITE_GROUP = "All Seasons"

# Workshop Maps live apart from the campaign boards: their own list, data/workshop.json
# (what the site's Workshop tab lists, and the collector's memory of what it last read),
# and one board file per Map, data/workshop/<pfid>.json. They are not in BOARDS or
# index.json, so the podiums and the composite stay campaign-only; derive() takes their
# rows (workshop_boards) only to put them in the player shards.
WORKSHOP_GROUP = "Workshop"
WORKSHOP_PATH = os.path.join(DATA_DIR, "workshop.json")
WORKSHOP_DIR = os.path.join(DATA_DIR, "workshop")
# Every Map's board is read at least this often, whatever the Workshop counters say:
# nothing on the Workshop moves when a player beats their own time.
FULL_SWEEP_SECONDS = 24 * 3600
# A catalogue this much smaller than the last one is a broken read, not mass deletion.
WORKSHOP_SHRINK_LIMIT = 0.9
# A creator's own time must be faster than their author time by at least this much to
# count as a beat. The author time in the Workshop metadata and the leaderboard score
# of the very same publishing run disagree by up to ~0.75 ms in observed data (float
# noise), so anything under 1 ms would count the publishing run itself as a beat.
CREATOR_BEAT_MARGIN_TICKS = 100  # 1 ms



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
    if name in ("OverallLeaderboard", "OverallLeaderboard_EASeason2", COMPOSITE_BOARD):
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


# Names are carried forward from the committed board files rather than looked up
# every run (13k players is 131 GetPlayerSummaries calls). A run looks up players it
# has no name for, plus one slice of everyone else: slices rotate every three hours,
# so every name is refreshed about once a week.
NAME_REFRESH_SLICES = 56


def known_names():
    """SteamID64 -> {persona, avatar, profileurl}, from every committed board file."""
    out = {}
    for folder in (BOARDS_DIR, WORKSHOP_DIR):
        if not os.path.isdir(folder):
            continue
        for fname in os.listdir(folder):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(folder, fname), encoding="utf-8") as f:
                    rows = json.load(f).get("rows") or []
            except Exception as e:
                print(f"  (could not read {fname} for names: {e!r})")
                continue
            for r in rows:
                if r.get("persona"):
                    out[r["steam_id"]] = {"persona": r["persona"], "avatar": r.get("avatar", ""),
                                          "profileurl": r.get("profileurl", "")}
    return out


def names_due(ids, known, now=None):
    """The IDs this run looks up: every one without a name, plus this run's slice."""
    slot = int(now if now is not None else time.time()) // (3 * 3600) % NAME_REFRESH_SLICES
    return [sid for sid in ids
            if sid not in known or (sid.isdigit() and int(sid) % NAME_REFRESH_SLICES == slot)]


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
        q = urllib.parse.urlencode({
            "key": key, "appid": APP_ID, "query_type": 1, "numperpage": 100,
            "cursor": cursor, "return_metadata": 1, "return_playtime_stats": 1,
        })
        with urllib.request.urlopen(
                "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?" + q,
                timeout=60) as r:
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
            maps.append({
                "pfid": pfid, "title": it.get("title") or b.get("level_display_name") or pfid,
                "creator": b.get("creator_name", ""), "created": int(it.get("time_created") or 0),
                "medals": medals, "board": board,
                "cid": str(it.get("creator") or ""), "preview": it.get("preview_url") or "",
                "sessions": int(it.get("lifetime_playtime_sessions") or 0),
                "subs": int(it.get("lifetime_subscriptions") or 0),
            })
        nxt = resp.get("next_cursor")
        if not batch or not nxt or nxt == cursor:
            break
        cursor = nxt
        time.sleep(0.3)
    if fetched < total:
        raise RuntimeError(f"Workshop catalogue came back short: {fetched} of {total} items")
    return maps


def load_workshop():
    """The committed data/workshop.json, or None."""
    if os.path.exists(WORKSHOP_PATH):
        try:
            with open(WORKSHOP_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"  (could not read existing workshop.json: {e!r})")
    return None


def workshop_board_doc(m, rows):
    """A Map's board file: the same shape as a campaign board file."""
    return {"name": m["name"], "display": m["display"], "group": WORKSHOP_GROUP,
            "handle": m["handle"], "entry_count": m["entry_count"], "rows": rows}


AUTHOR_MEDAL_INDEX = 3  # medal_times_by_index = [bronze, silver, gold, author], seconds


def workshop_stats(m, rows):
    """What the Workshop homepage shows of a Map without fetching its board: the top
    three (for the cards and the carousel) and the numbers the shelves sort on. Rows
    are rank-ordered and carry names. author_beaten counts runs at or under the author
    time, where the creator's own run counts only if CREATOR_BEAT_MARGIN_TICKS faster:
    the author time is their publishing run."""
    lead = rows[0]["score_ms"]
    author = m["medals"][AUTHOR_MEDAL_INDEX] * SCORE_TICKS_PER_SECOND
    return {
        "top3": [[r["steam_id"], r.get("persona", ""), r["score_ms"]] for r in rows[:3]],
        "gap13": rows[2]["score_ms"] - lead if len(rows) >= 3 else None,
        "crowd": sum(1 for r in rows if r["score_ms"] - lead <= SCORE_TICKS_PER_SECOND),
        "author_beaten": sum(1 for r in rows if r["score_ms"] <= (
            author - CREATOR_BEAT_MARGIN_TICKS if r["steam_id"] == m.get("cid") else author)),
    }


def workshop_boards(ws=None):
    """The Workshop boards as they stand: {"Workshop_<pfid>": rows} for every Map with
    a board, in the list's order. Without ws, the committed workshop.json and board
    files. With ws (what collect_workshop returns), this run's reads laid over the
    committed files of the Maps it did not read. A Map whose file is missing or empty
    is left out, as write_workshop lists it without a board."""
    maps = ws["maps"] if ws else (load_workshop() or {}).get("maps", [])
    fresh = ws["boards"] if ws else {}
    out = {}
    for m in maps:
        if not m.get("file"):
            continue
        rows = fresh.get(m["pfid"])
        if rows is None:
            path = os.path.join(DATA_DIR, m["file"])
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as f:
                rows = json.load(f).get("rows") or []
        if rows:
            out["Workshop_" + m["pfid"]] = rows
    return out


def write_workshop(ws, names):
    """Write the boards read this run, drop the files of Maps no longer on the
    Workshop, then the list. Boards not read this run keep their committed file, and
    their stats are worked out again from it, with this run's names on the top three
    so a renamed leader shows on the homepage before their board is next read. A Map
    whose committed file has gone missing is listed without a board until it is read."""
    os.makedirs(WORKSHOP_DIR, exist_ok=True)
    by_pfid = {m["pfid"]: m for m in ws["maps"]}
    boards = workshop_boards(ws)
    for m in ws["maps"]:
        if not m.get("file"):
            continue
        rows = boards.get("Workshop_" + m["pfid"])
        if rows is None:
            print(f"  [warn] Workshop Map {m['pfid']}: {m['file']} is missing or empty; listed without a board")
            m.update(file=None, rows=0)
            continue
        m.update(workshop_stats(m, rows))
        for t in m["top3"]:
            t[1] = names.get(t[0], {}).get("persona") or t[1]
    for pfid, rows in ws["boards"].items():
        with open(os.path.join(WORKSHOP_DIR, pfid + ".json"), "w", encoding="utf-8") as f:
            json.dump(workshop_board_doc(by_pfid[pfid], rows), f, ensure_ascii=False,
                      separators=(",", ":"))
    keep = {m["file"].split("/", 1)[1] for m in ws["maps"] if m.get("file")}
    for fname in os.listdir(WORKSHOP_DIR):
        if fname.endswith(".json") and fname not in keep:
            os.remove(os.path.join(WORKSHOP_DIR, fname))
    with open(WORKSHOP_PATH, "w", encoding="utf-8") as f:
        json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "full_sweep_at": ws["full_sweep_at"], "maps": ws["maps"]},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {WORKSHOP_PATH}: {len(ws['maps'])} Maps, {len(ws['boards'])} boards read this run")


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


def build_composite(boards_out):
    """The all-seasons board: each player's Overall points summed across every
    season, ranked highest first. A player missing from a season simply adds
    nothing for it, so a Season-2-only player ranks on Season 2 points alone.

    Ranks are sequential (1, 2, 3 ...) like every Steam board, because the
    site indexes rows by rank; equal totals keep their order of first
    appearance, oldest season first, which is stable from run to run. Each
    row keeps the per-season parts under "seasons" so the site can show where
    a total came from. Rows carry persona/avatar copied from the source rows,
    which write_site then refreshes along with every other board."""
    overall = [b for b in boards_out if b["name"].startswith("Overall")]
    players = {}
    for b in overall:
        for r in b["rows"]:
            p = players.setdefault(r["steam_id"], {
                "steam_id": r["steam_id"], "persona": r.get("persona", ""),
                "avatar": r.get("avatar", ""), "profileurl": r.get("profileurl", ""),
                "score_ms": 0, "seasons": {}})
            p["score_ms"] += r["score_ms"]
            p["seasons"][b["group"]] = r["score_ms"]
    rows = sorted(players.values(), key=lambda p: -p["score_ms"])
    for i, p in enumerate(rows):
        p["rank"] = i + 1
    return {"name": COMPOSITE_BOARD, "display": display_name(COMPOSITE_BOARD),
            "group": COMPOSITE_GROUP, "tier": None, "handle": None,
            "entry_count": len(rows), "rows": rows}


def player_shard(steam_id):
    """Which players file a Steam ID lives in: the last digit of the ID.

    A player's page needs that player's rank on every board at once, which is
    the transpose of the board files. Written whole it is a few megabytes, so it
    is split ten ways and the page fetches only the shard its player is in.
    Steam64 IDs are decimal, so the last digit divides them evenly; anything
    else (there should be nothing) lands in shard 0."""
    last = steam_id[-1:] if steam_id else ""
    return last if last.isdigit() else "0"


PLAYER_SHARDS = tuple("0123456789")


def build_players(boards_out, maps):
    """Every player's finish on every board, keyed by Steam ID, split into the
    ten shards player_shard() describes. Returns {shard: doc}. The boards are
    boards_out (campaign boards, composite last), then every Map's board from
    maps, {"Workshop_<pfid>": rows}, so a Workshop-only player has a page too.

    A player's rows are [board index, rank, score] triples, indexed against the
    shard's own "boards" list rather than index.json, so a shard the page has
    cached alongside a newer index can still be read correctly. Each board in
    that list carries "lead", its rank-1 score, which is all the page needs to
    show a run's gap to the record without fetching the board itself.

    persona/avatar/profileurl are copied from the rows, so this must be built
    after write_site's name refresh. profileurl is carried rather than derived:
    a third of players have a vanity /id/ URL that a Steam ID cannot produce."""
    sources = [(b["name"], b["rows"]) for b in boards_out] + list(maps.items())
    boards = [{"name": name, "lead": rows[0]["score_ms"] if rows else None}
              for name, rows in sources]
    players = {s: {} for s in PLAYER_SHARDS}
    for i, (_, rows) in enumerate(sources):
        for r in rows:
            sid = r["steam_id"]
            p = players[player_shard(sid)].setdefault(sid, {
                "persona": r.get("persona", ""), "avatar": r.get("avatar", ""),
                "profileurl": r.get("profileurl", ""), "rows": []})
            p["rows"].append([i, r["rank"], r["score_ms"]])
    return {s: {"shard": s, "boards": boards, "players": players[s]}
            for s in PLAYER_SHARDS}


def derive(boards_out, maps):
    """Everything the collector works out from the board rows it just read.

    maps is the Workshop boards, {"Workshop_<pfid>": rows} (workshop_boards). They
    go into the player shards and nowhere else: not the podiums, not the composite.

    Returns (boards_out with the composite appended, [artifact, ...]) where an
    artifact is {"path" (relative to data/), "doc", "empty", "summary"}. This is
    the one description of what is derived, where it lands, what counts as empty
    and how it reads in a log: write_site publishes the list, check_data compares
    the committed files against it, and neither has to restate the assembly —
    which matters, because the shards' board indices are positions in exactly
    this list of boards: campaign boards, composite, then every Map. Nor does either caller have to know one
    artifact from another; both just write or compare, and print the summary.

    Each artifact carries its own idea of empty, because only its builder knows
    what nothing looks like: no seasons, or a season with nobody on a podium, or
    a shard with no players."""
    composite = build_composite(boards_out)
    if composite["rows"]:
        boards_out = boards_out + [composite]
    seasons = build_podiums(boards_out)
    artifacts = [{
        "path": "podiums.json", "doc": {"seasons": seasons},
        "empty": not seasons or any(not s["players"] for s in seasons),
        # ASCII only: this prints to a Windows console in the local runbook
        "summary": "podiums  " + ", ".join(
            f"{s['group']} tracks={s['tracks']} players={len(s['players'])}" for s in seasons),
    }]
    artifacts += [{
        "path": "players/" + shard + ".json", "doc": doc,
        "empty": not doc["players"],
        "summary": f"players/{shard}  {len(doc['players'])} players",
    } for shard, doc in build_players(boards_out, maps).items()]
    return boards_out, artifacts


def name_rows(row_lists, all_ids):
    """Put persona/avatar/profileurl on every row in row_lists, and return the
    SteamID64 -> names map they came from. Names are carried forward from the
    committed board files; only players without one, plus this run's slice
    (names_due), are looked up."""
    key = load_key()
    if not key:
        print("WARNING: no STEAM_API_KEY (env or .env) — names will be blank (ids still collected).")
    known = known_names()
    # The slice covers every player we know, not only this run's rows: a Workshop board
    # is re-read only when played, so its players would otherwise rarely come up.
    due = names_due(set(all_ids) | set(known), known)
    print(f"Resolving {len(due)} of {len(all_ids)} player names (new, plus this run's slice)...")
    names = {sid: dict(v) for sid, v in known.items()}
    for sid, info in resolve_names(key, due).items():
        cur = names.setdefault(sid, {})
        for field, val in info.items():
            if val:
                cur[field] = val

    for rows in row_lists:
        for r in rows:
            info = names.get(r["steam_id"], {})
            # Prefer a freshly-resolved value, but keep any existing one if this
            # run's resolution came back empty (e.g. a failed GetPlayerSummaries
            # chunk, or rows reused from a previous run).
            r["persona"] = info.get("persona") or r.get("persona", "")
            r["avatar"] = info.get("avatar") or r.get("avatar", "")
            r["profileurl"] = info.get("profileurl") or r.get("profileurl", "")
    return names


def committed_boards():
    """The committed Circuit boards, in BOARDS order, each with its group: what
    derive() takes when this run read no Circuit board (--workshop-only). A board
    with no file or no rows is left out, and the podiums it feeds come out short."""
    out = []
    for name, group in BOARDS:
        b = load_existing_board(name)
        if b and b.get("rows"):
            b["group"] = group
            out.append(b)
    return out


def write_derived(artifacts):
    """Write derive()'s artifacts, or none of them if any came out empty."""
    blank = [a["path"] for a in artifacts if a["empty"]]
    if blank:
        print(f"  [warn] derived empty: {blank}; keeping the committed copies of all "
              f"{len(artifacts)} derived files")
        return
    for a in artifacts:
        path = os.path.join(DATA_DIR, a["path"])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(a["doc"], f, ensure_ascii=False, separators=(",", ":"))
        print("  " + a["summary"])


def write_site(boards_out, all_ids, workshop=None):
    """Resolve names, then write one file per board (data/boards/<name>.json) plus
    a small data/index.json the page loads first. Board files omit generated_at so
    an unchanged board produces no diff (only index.json changes every run).

    workshop, when given, is {"maps", "boards": {pfid: rows}, "full_sweep_at"}:
    its rows get names from the same lookup, then write_workshop publishes it."""
    # Names first: derive() copies persona/avatar/profileurl from the rows, so
    # rows it reads without names publish derived files with blank ones while
    # the boards get theirs (the 2026-09-27T23:32Z refresh did exactly that).
    ws_rows = list(workshop["boards"].values()) if workshop else []
    names = name_rows([b["rows"] for b in boards_out] + ws_rows, all_ids)
    if workshop:
        # Guarded: nothing on the Workshop side may stop the campaign files below.
        try:
            write_workshop(workshop, names)
        except Exception as e:
            print(f"  [warn] Workshop files not written: {e!r}")

    # Everything below the boards is derived from the named rows above, fallback
    # data included, so it can never disagree with the boards the page shows.
    # The composite comes back inside boards_out, which puts it through the same
    # file write and index entry as a Steam board. The Maps are read back from the
    # Workshop files as they now stand on disk: this run's, or the committed ones when
    # the Workshop step failed or its write did. Either way the shards agree with the
    # Map files, and a bad run never blanks anyone's Workshop times on their page.
    boards_out, artifacts = derive(boards_out, workshop_boards())
    composite = next((b for b in boards_out if b["name"] == COMPOSITE_BOARD), None)
    if composite:
        print(f"  {COMPOSITE_BOARD:34s} derived  players={len(composite['rows'])}")
    else:
        print(f"  [warn] {COMPOSITE_BOARD}: no Overall rows to derive from; not written")

    os.makedirs(BOARDS_DIR, exist_ok=True)
    index_boards = []
    unique = set()
    for b in boards_out:
        for r in b["rows"]:
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

    # The derived files carry the same never-publish-empty rule as the boards,
    # and they carry it together: they all come from the one set of rows, so one
    # of them arriving blank says the rows were blank, and every committed copy
    # is the better copy. Like the board files they omit generated_at, so an
    # unchanged season produces no diff.
    write_derived(artifacts)

    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "app_id": APP_ID, "player_count": len(unique),
                   "boards": index_boards}, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {INDEX_PATH} + {len(boards_out)} board files ({len(unique)} unique players)")
    return INDEX_PATH
