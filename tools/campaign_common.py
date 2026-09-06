"""
Shared constants + helpers for the Ballest campaign leaderboard collectors.

Used by:
  - steampy_collect.py  (headless, refresh-token login — the CI path)
  - steampy_mint.py     (one-time interactive token mint + validation)

Pure stdlib so it imports under any Python the collectors run on.
"""
import os, time, json, urllib.request, urllib.parse

APP_ID = 3339810
TOP_N = 100

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, "data", "campaign.json")

# Leaderboard names = level asset names, verbatim (discovered by probing the pak).
S1_TRACKS = ["Map_Track13", "Map_Track15", "Map_Track16", "Map_Track05",
             "Map_Track18", "Map_Track21", "Map_Track22", "Map_Track19"]
S2_TRACKS = ["Map_Track_S2_Sampler", "Map_Track_S2_Longhaul", "Map_Track_S2_Pyramids",
             "Map_Track_S2_BigStairs", "Map_Track_S2_Checkerboard", "Map_Track_S2_Loopworks",
             "Map_Track_S2_TinyTower", "Map_Track_S2_Downhill", "Map_Track_S2_NightCondo",
             "Map_Track_S2_NightVents", "Map_Track_S2_NightWay", "Map_Track_S2_NightClimb"]

# Steam leaderboard IDs, keyed by name. steam.py's find-by-name (LBSFindOrCreateLB)
# returns InvalidParameter for this app, so the collector reads entries directly by
# ID (LBSGetLBEntries), which works. These IDs are stable for the campaign boards.
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
    [("Map_TheTower", "Trials")]
)


def display_name(name):
    if name == "OverallLeaderboard":
        return "Season 1 — Overall"
    if name == "OverallLeaderboard_EASeason2":
        return "Season 2 — Overall"
    if name == "Map_TheTower":
        return "The Tower"
    if name.startswith("Map_Track_S2_"):
        return "S2 — " + name[len("Map_Track_S2_"):]
    if name.startswith("Map_Track"):
        return "Track " + name[len("Map_Track"):].lstrip("_")
    return name


def fmt_time(ms):
    ms = int(ms)
    m, rem = divmod(abs(ms), 60000)
    s, msec = divmod(rem, 1000)
    return f"{m}:{s:02d}.{msec:03d}"


def load_key():
    """Steam Web API key: env STEAM_API_KEY first (CI), then the local .env file."""
    key = os.environ.get("STEAM_API_KEY", "").strip()
    if key:
        return key
    env_path = os.path.join(PROJ, ".env")
    if os.path.exists(env_path):
        for line in open(env_path, encoding="utf-8"):
            line = line.strip()
            if line.startswith("STEAM_API_KEY=") and not line.startswith("#"):
                return line.split("=", 1)[1].strip()
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


def write_campaign(boards_out, all_ids):
    """Resolve names into the rows and write data/campaign.json. Returns the path."""
    key = load_key()
    if not key:
        print("WARNING: no STEAM_API_KEY (env or .env) — names will be blank (ids still collected).")
    print(f"Resolving {len(all_ids)} player names...")
    names = resolve_names(key, all_ids)
    for b in boards_out:
        for r in b["rows"]:
            info = names.get(r["steam_id"], {})
            r["persona"] = info.get("persona", "")
            r["avatar"] = info.get("avatar", "")
            r["profileurl"] = info.get("profileurl", "")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "app_id": APP_ID, "boards": boards_out}, f, indent=2)
    print(f"\nWrote {OUT}  ({len(boards_out)} boards, {len(all_ids)} players)")
    return OUT
