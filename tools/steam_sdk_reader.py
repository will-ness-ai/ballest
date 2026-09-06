"""
Ballest leaderboard reader via the Steamworks SDK (steam_api64.dll).

No password, no 2FA: this attaches to your ALREADY-LOGGED-IN Steam client and
reads leaderboards exactly the way the game does. Requirements:
  - Steam client running and logged in as the account that owns Ballest.
  - Ballest itself CLOSED (avoid two SteamAPI_Init for the same appid).
  - steam_api64.dll + steam_appid.txt present next to this script (run-sdk.ps1 handles that).

Usage:  python steam_sdk_reader.py "<leaderboard_name>"
Default name is the 2026-09-05 daily captured earlier.
"""
import os
import sys
import time
import json
import ctypes as C

APP_ID = 3339810
DEFAULT_NAME = "ballest_v0_3607858889_Daily_20260905_cec1096c"
HERE = os.path.dirname(os.path.abspath(__file__))
DLL_PATH = os.path.join(HERE, "steam_api64.dll")
OUT = os.path.abspath(os.path.join(HERE, "..", "capture", "leaderboard_sample.txt"))

# Steamworks callback ids
K_LeaderboardFindResult = 1104
K_LeaderboardScoresDownloaded = 1105
# ELeaderboardDataRequest
K_Global = 0

lines = []
def log(s=""):
    print(s); lines.append(str(s))
def flush():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")


class LeaderboardFindResult_t(C.Structure):
    _pack_ = 8
    _fields_ = [("m_hSteamLeaderboard", C.c_uint64),
                ("m_bLeaderboardFound", C.c_uint8)]

class LeaderboardScoresDownloaded_t(C.Structure):
    _pack_ = 8
    _fields_ = [("m_hSteamLeaderboard", C.c_uint64),
                ("m_hSteamLeaderboardEntries", C.c_uint64),
                ("m_cEntryCount", C.c_int32)]

class LeaderboardEntry_t(C.Structure):
    _pack_ = 8
    _fields_ = [("m_steamIDUser", C.c_uint64),
                ("m_nGlobalRank", C.c_int32),
                ("m_nScore", C.c_int32),
                ("m_cDetails", C.c_int32),
                ("m_hUGC", C.c_uint64)]


def fmt_time(ms):
    ms = int(ms); neg = ms < 0; ms = abs(ms)
    m, rem = divmod(ms, 60000); s, msec = divmod(rem, 1000)
    return ("-" if neg else "") + f"{m}:{s:02d}.{msec:03d}"


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NAME

    if not os.path.exists(DLL_PATH):
        log(f"ERROR: steam_api64.dll not found at {DLL_PATH}"); flush(); return 2
    # steam_appid.txt must be in CWD for SteamAPI_Init
    try:
        open(os.path.join(os.getcwd(), "steam_appid.txt"), "w").write(str(APP_ID))
    except Exception:
        pass
    os.environ.setdefault("SteamAppId", str(APP_ID))
    os.environ.setdefault("SteamGameId", str(APP_ID))

    lib = C.CDLL(DLL_PATH)

    # --- signatures ---
    # Modern SDK: SteamAPI_Init is an inline; the real export is SteamAPI_InitFlat.
    lib.SteamAPI_InitFlat.restype = C.c_int          # ESteamAPIInitResult (0 = OK)
    lib.SteamAPI_InitFlat.argtypes = [C.c_char_p]    # char errMsg[1024]
    lib.SteamAPI_Shutdown.restype = None
    lib.SteamAPI_RunCallbacks.restype = None
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
    lib.SteamAPI_ISteamUserStats_GetDownloadedLeaderboardEntry.argtypes = [C.c_void_p, C.c_uint64, C.c_int, C.POINTER(LeaderboardEntry_t), C.POINTER(C.c_int32), C.c_int]
    lib.SteamAPI_ISteamUserStats_GetLeaderboardEntryCount.restype = C.c_int
    lib.SteamAPI_ISteamUserStats_GetLeaderboardEntryCount.argtypes = [C.c_void_p, C.c_uint64]
    lib.SteamAPI_ISteamUserStats_GetLeaderboardName.restype = C.c_char_p
    lib.SteamAPI_ISteamUserStats_GetLeaderboardName.argtypes = [C.c_void_p, C.c_uint64]
    for opt in ("GetLeaderboardDisplayType", "GetLeaderboardSortMethod"):
        fn = getattr(lib, "SteamAPI_ISteamUserStats_" + opt, None)
        if fn: fn.restype = C.c_int; fn.argtypes = [C.c_void_p, C.c_uint64]

    log(f"App: {APP_ID}")
    log(f"Leaderboard name: {name}")
    log("")
    log("Initializing Steamworks (needs Steam running + logged in, game closed)...")
    errbuf = C.create_string_buffer(1024)
    init_rc = lib.SteamAPI_InitFlat(errbuf)
    if init_rc != 0:
        rc_map = {1: "FailedGeneric", 2: "NoSteamClient", 3: "VersionMismatch"}
        log(f"ERROR: SteamAPI_InitFlat returned {init_rc} ({rc_map.get(init_rc,'?')}): {errbuf.value.decode('utf-8','replace')}")
        log("Check: Steam client running + logged in, Ballest fully closed, account owns the game.")
        flush(); return 1
    log("  Steam initialized OK.")

    stats = lib.SteamAPI_SteamUserStats_v013()
    utils = lib.SteamAPI_SteamUtils_v010()

    def wait_call(handle, cb_struct, cb_id, timeout=25):
        failed = C.c_bool(False)
        t0 = time.time()
        while time.time() - t0 < timeout:
            lib.SteamAPI_RunCallbacks()
            if lib.SteamAPI_ISteamUtils_IsAPICallCompleted(utils, handle, C.byref(failed)):
                out = cb_struct()
                ok = lib.SteamAPI_ISteamUtils_GetAPICallResult(
                    utils, handle, C.byref(out), C.sizeof(out), cb_id, C.byref(failed))
                if ok and not failed.value:
                    return out
                return None
            time.sleep(0.05)
        return None

    # --- find leaderboard ---
    fh = lib.SteamAPI_ISteamUserStats_FindLeaderboard(stats, name.encode("utf-8"))
    res = wait_call(fh, LeaderboardFindResult_t, K_LeaderboardFindResult)
    if not res or not res.m_bLeaderboardFound:
        log("ERROR: leaderboard not found (name wrong, or not created yet).")
        lib.SteamAPI_Shutdown(); flush(); return 1
    lb = res.m_hSteamLeaderboard
    count = lib.SteamAPI_ISteamUserStats_GetLeaderboardEntryCount(stats, lb)
    real_name = lib.SteamAPI_ISteamUserStats_GetLeaderboardName(stats, lb)
    disp = getattr(lib, "SteamAPI_ISteamUserStats_GetLeaderboardDisplayType", None)
    sort = getattr(lib, "SteamAPI_ISteamUserStats_GetLeaderboardSortMethod", None)
    log("")
    log(f"FOUND leaderboard handle={lb}")
    log(f"  name        : {real_name.decode() if real_name else '?'}")
    log(f"  entry_count : {count}")
    if disp: log(f"  display_type: {disp(stats, lb)}  (2=TimeSeconds, 3=TimeMilliSeconds, 1=Numeric)")
    if sort: log(f"  sort_method : {sort(stats, lb)}  (1=Ascending, 2=Descending)")

    # --- download top N ---
    topn = min(count, 25) if count > 0 else 25
    dh = lib.SteamAPI_ISteamUserStats_DownloadLeaderboardEntries(stats, lb, K_Global, 1, topn)
    dl = wait_call(dh, LeaderboardScoresDownloaded_t, K_LeaderboardScoresDownloaded)
    if not dl:
        log("ERROR: DownloadLeaderboardEntries timed out."); lib.SteamAPI_Shutdown(); flush(); return 1

    entries_handle = dl.m_hSteamLeaderboardEntries
    n = dl.m_cEntryCount
    log("")
    log(f"Downloaded {n} entries. Top rows (rank | steamid64 | raw score | as-ms | details):")
    details_max = 64
    details_buf = (C.c_int32 * details_max)()
    rows = []
    for i in range(n):
        entry = LeaderboardEntry_t()
        ok = lib.SteamAPI_ISteamUserStats_GetDownloadedLeaderboardEntry(
            stats, entries_handle, i, C.byref(entry), details_buf, details_max)
        if not ok:
            continue
        sid = entry.m_steamIDUser
        det = [details_buf[j] for j in range(entry.m_cDetails)] if entry.m_cDetails else []
        log(f"  {entry.m_nGlobalRank:>4} | {sid} | {entry.m_nScore} | {fmt_time(entry.m_nScore)} | {det}")
        rows.append({"rank": entry.m_nGlobalRank, "steam_id": str(sid),
                     "score": entry.m_nScore, "ugc_id": str(entry.m_hUGC), "details": det})

    try:
        json.dump({"name": name, "handle": str(lb), "entry_count": count, "rows": rows},
                  open(OUT.replace(".txt", ".json"), "w", encoding="utf-8"), indent=2)
    except Exception:
        pass

    lib.SteamAPI_Shutdown()
    flush()
    log(f"\nWrote {OUT}")
    return 0


if __name__ == "__main__":
    rc = main()
    try: flush()
    except Exception: pass
    sys.exit(rc)
