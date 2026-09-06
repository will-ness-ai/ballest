"""
Ballest leaderboard prover.
Proves we can read Steam leaderboard entries for appid 3339810 via the Steam
client protocol (ValvePython/steam), decode the times, and resolve names.

Run it yourself:  python tools\steam_prover.py
- It tries ANONYMOUS login first (no credentials).
- If anonymous can't read the board, it falls back to an interactive login where
  YOU type your own Steam username / password / Steam Guard code. This script
  never stores or transmits your password anywhere except to Steam's own login.

Writes a summary to capture\leaderboard_sample.txt (safe to share) so it can be reviewed.
"""
import os
import sys
import json
import traceback

APP_ID = 3339810
# A known daily leaderboard name captured from Backend B (2026-09-05 daily "Loaf Glitch").
LB_NAME = "ballest_v0_3607858889_Daily_20260905_cec1096c"
LB_ID_HINT = 20820016

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "capture", "leaderboard_sample.txt")
OUT = os.path.abspath(OUT)

lines = []
def log(s=""):
    print(s)
    lines.append(str(s))

def flush():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

def fmt_time(ms):
    """Interpret an int score as milliseconds -> M:SS.mmm (best-guess encoding)."""
    try:
        ms = int(ms)
    except Exception:
        return "?"
    neg = ms < 0
    ms = abs(ms)
    m, rem = divmod(ms, 60000)
    s, msec = divmod(rem, 1000)
    return ("-" if neg else "") + f"{m}:{s:02d}.{msec:03d}"

def main():
    try:
        from steam.client import SteamClient
        from steam.enums import EResult
    except Exception:
        log("ERROR: the 'steam' library isn't installed. Run:")
        log("  python -m pip install --user \"steam[client]\"")
        flush(); return 2

    client = SteamClient()

    log(f"App: {APP_ID}")
    log(f"Leaderboard name: {LB_NAME}")
    log(f"(id hint from capture: {LB_ID_HINT})")
    log("")

    # --- 1. try anonymous ---
    mode = None
    lb = None
    log("Attempting ANONYMOUS login...")
    try:
        r = client.anonymous_login()
        if r == EResult.OK:
            log("  anonymous login OK; trying to read the leaderboard...")
            try:
                lb = client.get_leaderboard(APP_ID, LB_NAME)
                mode = "anonymous"
            except Exception as e:
                log(f"  anonymous could not read leaderboard: {e!r}")
        else:
            log(f"  anonymous login result: {r!r}")
    except Exception as e:
        log(f"  anonymous login raised: {e!r}")

    # --- 2. fall back to interactive user login ---
    if lb is None:
        log("")
        log("Falling back to interactive login. You will be prompted for YOUR Steam")
        log("credentials by Steam's own client library. Nothing is stored by this script.")
        log("")
        try:
            client.logout()
        except Exception:
            pass
        client = SteamClient()
        try:
            client.cli_login()  # prompts username / password / Steam Guard in this console
            lb = client.get_leaderboard(APP_ID, LB_NAME)
            mode = "user"
        except Exception as e:
            log(f"ERROR: login or leaderboard lookup failed: {e!r}")
            log(traceback.format_exc())
            flush(); return 1

    # --- 3. report ---
    log("")
    log(f"SUCCESS via {mode} login.")
    log(f"  leaderboard id      : {getattr(lb, 'id', '?')}")
    log(f"  name                : {getattr(lb, 'name', '?')}")
    log(f"  entry_count         : {getattr(lb, 'entry_count', '?')}")
    log(f"  sort_method         : {getattr(lb, 'sort_method', '?')}")
    log(f"  display_type        : {getattr(lb, 'display_type', '?')}  (tells us seconds vs milliseconds)")
    log("")
    log("Top entries (rank | steamid64 | raw score | as-ms | as-centis | details | ugc_id):")

    try:
        entries = lb[1:21]
    except Exception as e:
        log(f"  could not slice entries: {e!r}")
        log(traceback.format_exc())
        flush(); return 1

    rows = []
    for e in entries:
        sid = getattr(e, "steam_id_user", getattr(e, "steam_id", "?"))
        rank = getattr(e, "global_rank", "?")
        score = getattr(e, "score", "?")
        details = getattr(e, "details", b"")
        ugc = getattr(e, "ugc_id", "?")
        det_repr = details.hex() if isinstance(details, (bytes, bytearray)) else str(details)
        as_ms = fmt_time(score)
        as_centi = fmt_time(int(score) * 10) if str(score).lstrip("-").isdigit() else "?"
        log(f"  {rank:>4} | {sid} | {score} | {as_ms} | {as_centi} | {det_repr[:40]} | {ugc}")
        rows.append({"rank": rank, "steam_id": str(sid), "score": score, "ugc_id": str(ugc), "details_hex": det_repr})

    # best-effort name resolution for the first few (no API key; via client)
    log("")
    log("Name resolution (best-effort, first 5):")
    for e in entries[:5]:
        sid = getattr(e, "steam_id_user", None)
        name = "?"
        try:
            u = client.get_user(sid, fetch_persona=True)
            name = u.name
        except Exception as ex:
            name = f"(unresolved: {ex!r})"
        log(f"  {sid} -> {name}")

    # dump machine-readable json next to the txt
    try:
        with open(OUT.replace(".txt", ".json"), "w", encoding="utf-8") as f:
            json.dump({"mode": mode, "leaderboard": getattr(lb, "name", None),
                       "id": getattr(lb, "id", None), "entry_count": getattr(lb, "entry_count", None),
                       "display_type": str(getattr(lb, "display_type", None)),
                       "sort_method": str(getattr(lb, "sort_method", None)),
                       "rows": rows}, f, indent=2)
    except Exception:
        pass

    flush()
    log(f"\nWrote {OUT}")
    return 0

if __name__ == "__main__":
    rc = main()
    try:
        flush()
    except Exception:
        pass
    sys.exit(rc)
