"""
Probe candidate leaderboard NAMES via the Steamworks SDK to learn the naming
pattern for non-daily boards (The Tower, Circuit tracks, Hub tracks).
Prints which candidate names exist and their entry_count.

Run via run-probe-names.ps1 (Steam running+logged in, Ballest closed).
"""
import os, sys, time, ctypes as C

APP_ID = 3339810
HERE = os.path.dirname(os.path.abspath(__file__))
DLL_PATH = os.path.join(HERE, "steam_api64.dll")
K_Find = 1104

class LBFind(C.Structure):
    _pack_ = 8
    _fields_ = [("h", C.c_uint64), ("found", C.c_uint8)]

# Candidate names to test. Derived from: daily pattern ballest_v0_<workshopId>_Daily_<date>_<short>,
# telemetry level names (Map_TheTower, Map_Track_S2_Sampler), and a known Hub workshop id (3607858889).
CANDIDATES = [
    # Overall / aggregate boards (keys found in circuit level-list assets)
    "OverallLeaderboard",
    "OverallLeaderboard_EASeason2",
    "ballest_v0_OverallLeaderboard",
    "ballest_v0_OverallLeaderboard_EASeason2",
    # Per-track: S1 shipping track (Map_Track13), various name shapes
    "Map_Track13",
    "ballest_v0_Map_Track13",
    "Track13",
    "ballest_v0_Track13",
    "Map_Track13_Global",
    "ballest_v0_Map_Track13_Global",
    "ballest_v0_Map_Track13_EASeason2",
    # Per-track: S2 shipping track
    "Map_Track_S2_Sampler",
    "ballest_v0_Map_Track_S2_Sampler",
    "ballest_v0_Map_Track_S2_Sampler_EASeason2",
    # The Tower
    "Map_TheTower",
    "ballest_v0_Map_TheTower",
    "TheTower",
    "ballest_v0_TheTower",
]

def main():
    if not os.path.exists(DLL_PATH):
        print("DLL missing:", DLL_PATH); return 2
    open(os.path.join(os.getcwd(), "steam_appid.txt"), "w").write(str(APP_ID))
    os.environ.setdefault("SteamAppId", str(APP_ID))
    lib = C.CDLL(DLL_PATH)
    lib.SteamAPI_InitFlat.restype = C.c_int; lib.SteamAPI_InitFlat.argtypes = [C.c_char_p]
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
    lib.SteamAPI_ISteamUserStats_GetLeaderboardEntryCount.restype = C.c_int
    lib.SteamAPI_ISteamUserStats_GetLeaderboardEntryCount.argtypes = [C.c_void_p, C.c_uint64]

    errbuf = C.create_string_buffer(1024)
    if lib.SteamAPI_InitFlat(errbuf) != 0:
        print("Init failed:", errbuf.value.decode('utf-8','replace')); return 1
    stats = lib.SteamAPI_SteamUserStats_v013()
    utils = lib.SteamAPI_SteamUtils_v010()

    def find(name):
        h = lib.SteamAPI_ISteamUserStats_FindLeaderboard(stats, name.encode())
        failed = C.c_bool(False); t0 = time.time()
        while time.time() - t0 < 12:
            lib.SteamAPI_RunCallbacks()
            if lib.SteamAPI_ISteamUtils_IsAPICallCompleted(utils, h, C.byref(failed)):
                out = LBFind()
                if lib.SteamAPI_ISteamUtils_GetAPICallResult(utils, h, C.byref(out), C.sizeof(out), K_Find, C.byref(failed)) and not failed.value:
                    return out
                return None
            time.sleep(0.05)
        return None

    print("candidate | found | handle | entry_count")
    for name in CANDIDATES:
        r = find(name)
        if r and r.found:
            cnt = lib.SteamAPI_ISteamUserStats_GetLeaderboardEntryCount(stats, r.h)
            print(f"  FOUND  {name}  handle={r.h} entries={cnt}")
        else:
            print(f"  -      {name}")
    lib.SteamAPI_Shutdown()
    return 0

if __name__ == "__main__":
    sys.exit(main())
