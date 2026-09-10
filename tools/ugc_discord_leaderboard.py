"""
Custom-map standings for Discord.

Enumerates every published Ballest Workshop map, reads each map's Steam leaderboard,
and prints a Discord-ready markdown post with two boards:

  * most custom maps beaten   — a player "beat" a map if they hold any time on its board
  * most author medals        — their time is at or under the map's author medal time

plus two lists with a Workshop link per map: maps nobody has beaten, and finished maps
whose author medal nobody has claimed. The post is split into as many Discord messages
as its sections need (usually two).

A map's own creator counts on it only by beating their own author time: the author
time is the creator's publishing run, so matching it is not a beat (see collect()).

Runs headless with the same refresh token CI uses; no Steam client needed. Writes
nothing into the repo (use --out / --json for files).

Run (from the repo root, in the steam.py venv — see tools/README-hosting.md):
  tools\\.venv-steampy\\Scripts\\python.exe tools\\ugc_discord_leaderboard.py
Options:
  --top N          rows per board (default 10)
  --out FILE       also write the post to FILE (a second message goes to FILE-2, etc.)
  --json FILE      also dump per-player and per-map numbers for checking
Auth: STEAM_REFRESH_TOKEN env var, else tools/refresh_token.txt (from steampy_mint.py);
      STEAM_API_KEY env var, else .env (Workshop catalogue + player names).
"""
import os, sys, json, time, asyncio, argparse, logging, urllib.request, urllib.parse
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc

import warnings
warnings.filterwarnings("ignore")  # silence steam.py's XML-as-HTML parser warning

import steam
from steam.protobufs import leaderboards

logging.basicConfig(level=logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.CRITICAL)

AUTHOR_MEDAL_INDEX = 3  # medal_times_by_index = [bronze, silver, gold, author], seconds
DISCORD_MESSAGE_LIMIT = 2000


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def load_token():
    tok = os.environ.get("STEAM_REFRESH_TOKEN", "").strip()
    if tok:
        return tok
    path = os.path.join(cc.HERE, "refresh_token.txt")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    return ""


# ---------------------------------------------------------------- Workshop catalogue

def workshop_maps(key):
    """Every published Workshop map with its leaderboard name and author medal time.

    IPublishedFileService/QueryFiles returns each map's metadata blob, in which the
    game itself records the Steam leaderboard name (ballest_v0_<pfid>_Climb_<title>)
    and the medal times. Key off that name, never the Workshop title: the name is
    fixed at publish time and survives a rename."""
    maps, cursor, seen = [], "*", set()
    while True:
        q = urllib.parse.urlencode({
            "key": key, "appid": cc.APP_ID, "query_type": 1, "numperpage": 100,
            "cursor": cursor, "return_metadata": 1,
        })
        with urllib.request.urlopen(
                "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?" + q,
                timeout=60) as r:
            resp = json.load(r)["response"]
        batch = resp.get("publishedfiledetails") or []
        for it in batch:
            pfid = it.get("publishedfileid")
            if pfid in seen:
                continue
            seen.add(pfid)
            try:
                b = json.loads(it.get("metadata") or "{}")["ballest"]
                board = b["leaderboard_name_current"]
                author = float(b["medal_times_by_index"][AUTHOR_MEDAL_INDEX])
            except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
                log(f"  [skip] {pfid} {it.get('title')!r}: no usable ballest metadata")
                continue
            maps.append({"pfid": pfid, "title": it.get("title", ""), "creator": str(it.get("creator", "")),
                         "board": board, "author_time": author})
        nxt = resp.get("next_cursor")
        if not batch or not nxt or nxt == cursor:
            break
        cursor = nxt
        time.sleep(0.3)
    return maps


# ---------------------------------------------------------------- Steam leaderboards

async def find_board_id(client, name):
    """Leaderboard name -> id, or 0 if the board doesn't exist (a map nobody has finished).

    steam.py's own fetch_leaderboard() fails with InvalidParameter for this app because
    it leaves the message header's routing_app_id unset; the CM only resolves a name
    when the request is routed under the app, as the game's SDK session does."""
    msg = leaderboards.CMsgClientLbsFindOrCreateLb(
        app_id=cc.APP_ID, leaderboard_name=name, create_if_not_found=False)
    msg.header.routing_app_id = cc.APP_ID
    resp = await client._state.ws.send_proto_and_wait(msg)
    if resp.result != steam.Result.OK:
        raise RuntimeError(f"LBSFindOrCreateLB result={resp.result!r}")
    return int(resp.leaderboard_id)


async def fetch_entries(client, lid):
    """Every entry on a board. Same conservative paging as steampy_collect.fetch_board:
    stop only when the board is exhausted, not on a short batch."""
    total, entries, start = None, [], 1
    while True:
        msg = await client._state.ws.send_proto_and_wait(
            leaderboards.CMsgClientLbsGetLbEntries(
                leaderboard_id=lid, app_id=cc.APP_ID,
                range_start=start, range_end=start + cc.FETCH_WINDOW - 1,
                leaderboard_data_request=0, steamids=[],
            )
        )
        if msg.result != steam.Result.OK:
            raise RuntimeError(f"LBSGetLBEntries result={msg.result!r}")
        if total is None:
            total = msg.leaderboard_entry_count
        batch = list(msg.entries)
        entries.extend(batch)
        if not batch or len(entries) >= total:
            break
        start = len(entries) + 1
    return entries


async def collect(client, maps):
    """Read every map's board. Returns (per-player stats, per-map stats, unreadable maps).

    Rule for a map's own creator: their entry counts (as a finish and as a medal) only
    if it is strictly faster than the author time recorded when the map was published.
    The author time IS the creator's publishing run, so merely matching it is not a
    beat. Everyone else counts on any finish, and medals at or under the author time.
    Scores are compared in leaderboard ticks with the same truncation the game applies
    to a run, so a creator's re-submitted publishing run lands exactly on the author
    time rather than a rounding hair under it."""
    players = defaultdict(lambda: {"beaten": 0, "author": 0})
    per_map, failed = [], []
    for i, m in enumerate(maps, 1):
        try:
            lid = await find_board_id(client, m["board"])
            entries = await fetch_entries(client, lid) if lid else []
        except Exception as e:
            failed.append(m["board"])
            log(f"  [warn] {i:3d}/{len(maps)} {m['title']!r}: read failed: {e!r}")
            continue
        author_ticks = int(m["author_time"] * cc.SCORE_TICKS_PER_SECOND)
        finishers = medalists = 0
        creator_beat_own = False
        for e in entries:
            sid = str(e.steam_id_user)
            score = int(e.score)
            if sid == m["creator"]:
                if score >= author_ticks:
                    continue
                creator_beat_own = True
            players[sid]["beaten"] += 1
            finishers += 1
            if score <= author_ticks:
                players[sid]["author"] += 1
                medalists += 1
        per_map.append({**m, "leaderboard_id": lid, "entries": len(entries),
                        "finishers": finishers, "author_medalists": medalists,
                        "creator_beat_own": creator_beat_own})
        log(f"  {i:3d}/{len(maps)} {m['title'][:36]:36s} entries={len(entries):4d} author={medalists}")
        await asyncio.sleep(0.05)
    return players, per_map, failed


# ---------------------------------------------------------------- Discord post

WORKSHOP_URL = "https://steamcommunity.com/sharedfiles/filedetails/?id="


def md_escape(s):
    return "".join("\\" + c if c in "\\*_~`|>[]" else c for c in s)


def map_link(m):
    """Masked link to the map's Workshop page; the <> stop Discord unfurling an embed."""
    return f"[{md_escape(m['title'] or m['pfid'])}](<{WORKSHOP_URL}{m['pfid']}>)"


def ranked(players, key, top):
    rows = sorted(((p[key], sid) for sid, p in players.items() if p[key] > 0),
                  key=lambda t: (-t[0], t[1]))[:top]
    out, rank = [], 0
    for i, (n, sid) in enumerate(rows, 1):
        if i == 1 or n != rows[i - 2][0]:
            rank = i  # competition ranking: ties share a rank
        out.append((rank, sid, n))
    return out


def build_sections(players, per_map, names, top, failed):
    """The "quote cards" layout chosen in the design round: each board is a quoted block
    with Discord's own numbered list inside, so the client draws the rank column and the
    bar. Discord renumbers list items sequentially whatever number is written, so ties
    cannot share a rank here; the written number is the row position.

    Returns the post as a list of sections (strings) for pack_messages to split."""
    def board(title, key, noun):
        lines = [f"> ### {title}"]
        for pos, (_rank, sid, n) in enumerate(ranked(players, key, top), 1):
            who = md_escape(names.get(sid, {}).get("persona") or sid)
            lines.append(f"> {pos}. **{who}** — {n} {noun}")
        if len(lines) == 1:
            lines.append("> _nobody yet_")
        return "\n".join(lines)

    when = time.strftime("%-d %b %Y" if os.name != "nt" else "%#d %b %Y", time.gmtime())
    head = "\n".join(["# Custom Map Standings",
                      f"-# {len(per_map)} Workshop maps · {len(players):,} players · {when}"])

    # "Unbeaten" and "unclaimed" follow the same rule as the standings (see collect):
    # a creator's own entry is on the board only if it beats their own author time.
    unbeaten = sorted((m for m in per_map if m["finishers"] == 0), key=lambda m: m["title"].lower())
    unclaimed = sorted((m for m in per_map if m["finishers"] and not m["author_medalists"]),
                       key=lambda m: (-m["finishers"], m["title"].lower()))
    lines = ["> ### 🚫 Unbeaten maps", "> Nobody has finished these yet."]
    lines += [f"> - {map_link(m)}" for m in unbeaten] or ["> - _none — every map has been beaten_"]
    unbeaten_sec = "\n".join(lines)
    lines = ["> ### 🎯 Author medals still unclaimed", "> Finished, but nobody has matched the author time."]
    lines += [f"> - {map_link(m)} — {m['finishers']} finisher{'s' if m['finishers'] != 1 else ''}" for m in unclaimed] \
        or ["> - _none — every finished map has an author medal_"]
    unclaimed_sec = "\n".join(lines)

    foot = "Creators count on their own maps only by beating their own author time. Source: Steam leaderboards."
    if failed:
        foot += f" ⚠️ {len(failed)} maps were unreadable this run."
    return [head, board("🏁 Most maps beaten", "beaten", "maps"), board("🏅 Most author medals", "author", "medals"),
            unbeaten_sec, unclaimed_sec, "-# " + foot]


def pack_messages(sections, limit=DISCORD_MESSAGE_LIMIT):
    """Join sections with blank lines into as few messages as fit under Discord's limit,
    never splitting a section. A single over-long section goes out as its own message."""
    messages, cur = [], ""
    for s in sections:
        cand = s if not cur else cur + "\n\n" + s
        if cur and len(cand) > limit:
            messages.append(cur)
            cur = s
        else:
            cur = cand
    if cur:
        messages.append(cur)
    return [m + "\n" for m in messages]


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Discord post: who has beaten the most custom maps / author medals.")
    ap.add_argument("--top", type=int, default=10, help="rows per board (default 10)")
    ap.add_argument("--out", help="also write the post to this file")
    ap.add_argument("--json", help="also dump per-player and per-map numbers to this file")
    args = ap.parse_args()

    token = load_token()
    if not token:
        log("ERROR: no refresh token (STEAM_REFRESH_TOKEN or tools/refresh_token.txt). Mint one with tools/steampy_mint.py.")
        return 2
    key = cc.load_key()
    if not key:
        log("ERROR: no STEAM_API_KEY (env or .env); it is needed to list Workshop maps.")
        return 2

    log("Listing Workshop maps...")
    maps = workshop_maps(key)
    log(f"  {len(maps)} maps from {len({m['creator'] for m in maps})} creators")
    if not maps:
        log("ERROR: Workshop query returned no maps.")
        return 1

    client = steam.Client()
    state = {"done": False, "result": None}

    @client.event
    async def on_ready():
        if state["done"]:
            return
        state["done"] = True
        try:
            log("Reading leaderboards...")
            state["result"] = await collect(client, maps)
        except Exception:
            import traceback
            traceback.print_exc()
        finally:
            await client.close()

    try:
        client.run(refresh_token=token)
    except Exception as e:
        if state["result"] is None:  # otherwise: benign session-teardown noise after close()
            log(f"ERROR: Steam login/run failed: {e!r}")
            return 1

    if state["result"] is None:
        log("ERROR: leaderboard collection did not complete.")
        return 1
    players, per_map, failed = state["result"]
    if not per_map:
        log("ERROR: no board could be read; not producing a post.")
        return 1

    shown = {sid for k in ("beaten", "author") for _, sid, _ in ranked(players, k, args.top)}
    log(f"Resolving {len(shown)} player names...")
    names = cc.resolve_names(key, shown)

    messages = pack_messages(build_sections(players, per_map, names, args.top, failed))
    for i, msg in enumerate(messages, 1):
        if len(msg) > DISCORD_MESSAGE_LIMIT:
            log(f"NOTE: message {i} is {len(msg)} chars, over Discord's {DISCORD_MESSAGE_LIMIT}-char limit; lower --top.")
    if args.out:
        root, ext = os.path.splitext(args.out)
        for i, msg in enumerate(messages, 1):
            path = args.out if i == 1 else f"{root}-{i}{ext}"
            with open(path, "w", encoding="utf-8") as f:
                f.write(msg)
            log(f"Wrote {path} ({len(msg)} chars)")
    post = ("\n" + "═" * 12 + " next message " + "═" * 12 + "\n\n").join(messages)
    if len(messages) > 1:
        log(f"NOTE: the post is {len(messages)} Discord messages; paste them one after another.")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "rule": "creators count on their own maps only by beating their own author time",
                       "failed": failed,
                       "players": {sid: {**p, "persona": names.get(sid, {}).get("persona", "")}
                                   for sid, p in players.items()},
                       "maps": per_map}, f, ensure_ascii=False, indent=1)
        log(f"Wrote {args.json}")
    sys.stdout.reconfigure(encoding="utf-8")
    print(post, end="")
    if failed:
        log(f"WARNING: {len(failed)} map(s) unreadable; counts are incomplete: "
            f"{failed[:5]}{' ...' if len(failed) > 5 else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
