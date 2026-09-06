"""
Ballest campaign leaderboard collector.
Reads every campaign (Circuit + Tower) leaderboard via the Steamworks SDK
(no credentials; uses the logged-in Steam client), resolves player names via the
Steam Web API, and writes data/campaign.json for the website.

Run via run-collect.ps1 (Steam running + logged in, Ballest closed).
"""
import os, sys, time, json, urllib.request, urllib.parse, ctypes as C

APP_ID = 3339810
TOP_N = 100
HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DLL_PATH = os.path.join(HERE, "steam_api64.dll")
OUT = os.path.join(PROJ, "data", "campaign.json")

# Leaderboard names = level asset names, verbatim (discovered by probing).
S1_TRACKS = ["Map_Track13","Map_Track15","Map_Track16","Map_Track05",
             "Map_Track18","Map_Track21","Map_Track22","Map_Track19"]
S2_TRACKS = ["Map_Track_S2_Sampler","Map_Track_S2_Longhaul","Map_Track_S2_Pyramids",
             "Map_Track_S2_BigStairs","Map_Track_S2_Checkerboard","Map_Track_S2_Loopworks",
             "Map_Track_S2_TinyTower","Map_Track_S2_Downhill","Map_Track_S2_NightCondo",
             "Map_Track_S2_NightVents","Map_Track_S2_NightWay","Map_Track_S2_NightClimb"]

def display_name(name):
    if name == "OverallLeaderboard": return "Season 1 — Overall"
    if name == "OverallLeaderboard_EASeason2": return "Season 2 — Overall"
    if name == "Map_TheTower": return "The Tower"
    if name.startswith("Map_Track_S2_"): return "S2 — " + name[len("Map_Track_S2_"):]
    if name.startswith("Map_Track"): return "Track " + name[len("Map_Track"):].lstrip("_")
    return name

BOARDS = (
    [("OverallLeaderboard", "Season 1")] +
    [(t, "Season 1") for t in S1_TRACKS] +
    [("OverallLeaderboard_EASeason2", "Season 2")] +
    [(t, "Season 2") for t in S2_TRACKS] +
    [("Map_TheTower", "Trials")]
)

K_Find, K_Down = 1104, 1105

class LBFind(C.Structure):
    _pack_ = 8; _fields_ = [("h", C.c_uint64), ("found", C.c_uint8)]
class LBDown(C.Structure):
    _pack_ = 8; _fields_ = [("h", C.c_uint64), ("entries", C.c_uint64), ("count", C.c_int32)]
class LBEntry(C.Structure):
    _pack_ = 8; _fields_ = [("steam_id", C.c_uint64), ("rank", C.c_int32),
                            ("score", C.c_int32), ("cdetails", C.c_int32), ("ugc", C.c_uint64)]

# Scores are hundred-thousandths of a second, not milliseconds. See the note on
# SCORE_TICKS_PER_SECOND in campaign_common.py for the evidence.
SCORE_TICKS_PER_SECOND = 100000

def fmt_time(score):
    ms = abs(int(score)) * 1000 // SCORE_TICKS_PER_SECOND
    h, rem = divmod(ms, 3600000); m, rem = divmod(rem, 60000); s, msec = divmod(rem, 1000)
    return (f"{h}:{m:02d}" if h else f"{m}") + f":{s:02d}.{msec:03d}"

def load_key():
    for line in open(os.path.join(PROJ, ".env"), encoding="utf-8"):
        line = line.strip()
        if line.startswith("STEAM_API_KEY=") and not line.startswith("#"):
            return line.split("=", 1)[1].strip()
    return ""

def resolve_names(key, ids):
    """SteamID64 -> {persona, avatar} via GetPlayerSummaries (100 per call)."""
    out = {}
    ids = list(ids)
    if not key:
        return out
    for i in range(0, len(ids), 100):
        chunk = ids[i:i+100]
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


def main():
    if not os.path.exists(DLL_PATH):
        print("steam_api64.dll missing next to script; run run-collect.ps1"); return 2
    open(os.path.join(os.getcwd(), "steam_appid.txt"), "w").write(str(APP_ID))
    os.environ.setdefault("SteamAppId", str(APP_ID))
    key = load_key()
    if not key:
        print("WARNING: no STEAM_API_KEY in .env — names will be blank (ids still collected).")

    lib = C.CDLL(DLL_PATH)
    lib.SteamAPI_InitFlat.restype = C.c_int; lib.SteamAPI_InitFlat.argtypes = [C.c_char_p]
    lib.SteamAPI_Shutdown.restype = None; lib.SteamAPI_RunCallbacks.restype = None
    lib.SteamAPI_SteamUserStats_v013.restype = C.c_void_p
    lib.SteamAPI_SteamUtils_v010.restype = C.c_void_p
    lib.SteamAPI_ISteamUtils_IsAPICallCompleted.restype = C.c_bool
    lib.SteamAPI_ISteamUtils_IsAPICallCompleted.argtypes = [C.c_void_p, C.c_uint64, C.POINTER(C.c_bool)]
    lib.SteamAPI_ISteamUtils_GetAPICallResult.restype = C.c_bool
    lib.SteamAPI_ISteamUtils_GetAPICallResult.argtypes = [C.c_void_p, C.c_uint64, C.c_void_p, C.c_int, C.c_int, C.POINTER(C.c_bool)]
    lib.SteamAPI_ISteamUserStats_FindLeaderboard.restype = C.c_uint64
    lib.SteamAPI_ISteamUserStats_FindLeaderboard.argtypes = [C.c_void_p, C.c_char_p]
    lib.SteamAPI_ISteamUserStats_DownloadLeaderboardEntries.restype = C.c_uint64
    lib.SteamAPI_ISteamUserStats_DownloadLeaderboardEntries.argtypes = [C.c_void_p, C.c_uint64, C.c_int, C.c_int, C.c_int]
    lib.SteamAPI_ISteamUserStats_GetDownloadedLeaderboardEntry.restype = C.c_bool
    lib.SteamAPI_ISteamUserStats_GetDownloadedLeaderboardEntry.argtypes = [C.c_void_p, C.c_uint64, C.c_int, C.POINTER(LBEntry), C.POINTER(C.c_int32), C.c_int]
    lib.SteamAPI_ISteamUserStats_GetLeaderboardEntryCount.restype = C.c_int
    lib.SteamAPI_ISteamUserStats_GetLeaderboardEntryCount.argtypes = [C.c_void_p, C.c_uint64]

    errbuf = C.create_string_buffer(1024)
    if lib.SteamAPI_InitFlat(errbuf) != 0:
        print("SteamAPI init failed:", errbuf.value.decode('utf-8','replace'),
              "\n(Steam running+logged in? Ballest closed? account owns game?)"); return 1
    stats = lib.SteamAPI_SteamUserStats_v013()
    utils = lib.SteamAPI_SteamUtils_v010()

    def wait(handle, struct, cbid, timeout=25):
        failed = C.c_bool(False); t0 = time.time()
        while time.time() - t0 < timeout:
            lib.SteamAPI_RunCallbacks()
            if lib.SteamAPI_ISteamUtils_IsAPICallCompleted(utils, handle, C.byref(failed)):
                out = struct()
                if lib.SteamAPI_ISteamUtils_GetAPICallResult(utils, handle, C.byref(out), C.sizeof(out), cbid, C.byref(failed)) and not failed.value:
                    return out
                return None
            time.sleep(0.05)
        return None

    details = (C.c_int32 * 64)()
    boards_out = []
    all_ids = set()

    for name, group in BOARDS:
        fh = lib.SteamAPI_ISteamUserStats_FindLeaderboard(stats, name.encode())
        fr = wait(fh, LBFind, K_Find)
        if not fr or not fr.found:
            print(f"  [skip] not found: {name}"); continue
        lb = fr.h
        total = lib.SteamAPI_ISteamUserStats_GetLeaderboardEntryCount(stats, lb)
        topn = min(total, TOP_N) if total > 0 else TOP_N
        dh = lib.SteamAPI_ISteamUserStats_DownloadLeaderboardEntries(stats, lb, 0, 1, topn)
        dr = wait(dh, LBDown, K_Down)
        rows = []
        if dr:
            for i in range(dr.count):
                e = LBEntry()
                if lib.SteamAPI_ISteamUserStats_GetDownloadedLeaderboardEntry(stats, dr.entries, i, C.byref(e), details, 64):
                    sid = str(e.steam_id)
                    all_ids.add(sid)
                    rows.append({"rank": e.rank, "steam_id": sid,
                                 "score_ms": e.score, "time": fmt_time(e.score),
                                 "ugc_id": str(e.ugc)})
        boards_out.append({"name": name, "display": display_name(name), "group": group,
                           "handle": str(lb), "entry_count": total, "rows": rows})
        print(f"  {name:34s} total={total:6d} pulled={len(rows)}")

    lib.SteamAPI_Shutdown()

    print(f"Resolving {len(all_ids)} player names...")
    names = resolve_names(key, all_ids)
    for b in boards_out:
        for r in b["rows"]:
            info = names.get(r["steam_id"], {})
            r["persona"] = info.get("persona", "")
            r["avatar"] = info.get("avatar", "")
            r["profileurl"] = info.get("profileurl", "")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "app_id": APP_ID, "boards": boards_out},
              open(OUT, "w", encoding="utf-8"), indent=2)
    print(f"\nWrote {OUT}  ({len(boards_out)} boards, {len(all_ids)} players)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
