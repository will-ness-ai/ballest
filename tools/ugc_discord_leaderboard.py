"""
Custom-map standings for Discord.

Enumerates every published Ballest Workshop map, reads each map's Steam leaderboard,
and prints a Discord-ready markdown post with two boards:

  * most custom maps beaten   — a player "beat" a map if they hold any time on its board
  * most author medals        — their time is at or under the map's author medal time

a two-column table (Discord has no markdown tables, so it is a monospaced code block):

  * most world records        — maps where they hold the top time
  * most top-5 finishes       — maps where they sit in the top five

plus two lists with a Workshop link per map: maps nobody has beaten, and finished maps
whose author medal nobody has claimed (both only for maps published at least a day ago,
so a fresh upload gets a chance first), and the three longest-standing world records
on the campaign and on the Workshop (dated from each record's ghost replay). The post is
split into as many Discord messages as its sections need (usually two).

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
# A creator's own time must be faster than their author time by at least this much to
# count as a beat. The author time in the Workshop metadata and the leaderboard score
# of the very same publishing run disagree by up to ~0.75 ms in observed data (float
# noise), so anything under 1 ms would count the publishing run itself as a beat.
CREATOR_BEAT_MARGIN_TICKS = 100  # 1 ms
# A map has to have been on the Workshop this long before it can be listed as unbeaten
# or as having an unclaimed author medal; anything younger simply hasn't been played yet.
LIST_MIN_AGE_SECONDS = 24 * 3600


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
                         "board": board, "author_time": author,
                         "created": int(it.get("time_created") or 0)})
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
    if it beats the author time recorded when the map was published by at least
    CREATOR_BEAT_MARGIN_TICKS. The author time IS the creator's publishing run, so
    matching it is not a beat. Everyone else counts on any finish, and medals at or
    under the author time. Scores are compared in leaderboard ticks. Positions (world
    record, top 5) are counted among the entries that count, in rank order, so a
    creator's non-counting publishing run does not hold a record or push anyone down."""
    players = defaultdict(lambda: {"beaten": 0, "author": 0, "wr": 0, "top5": 0})
    per_map, failed = [], []
    for i, m in enumerate(maps, 1):
        try:
            lid = await find_map_board_id(client, m["board"])
            entries = await fetch_entries(client, lid) if lid else []
        except Exception as e:
            failed.append(m["board"])
            log(f"  [warn] {i:3d}/{len(maps)} {m['title']!r}: read failed: {e!r}")
            continue
        author_ticks = int(m["author_time"] * cc.SCORE_TICKS_PER_SECOND)
        finishers = medalists = 0
        creator_beat_own = False
        record = None  # the map's best finish that counts: entries arrive in rank order
        for e in entries:
            sid = str(e.steam_id_user)
            score = int(e.score)
            if sid == m["creator"]:
                if score > author_ticks - CREATOR_BEAT_MARGIN_TICKS:
                    continue
                creator_beat_own = True
            players[sid]["beaten"] += 1
            finishers += 1
            if finishers == 1:
                record = {"steam_id": sid, "score": score, "ugc_id": str(e.ugc_id)}
                players[sid]["wr"] += 1
            if finishers <= 5:
                players[sid]["top5"] += 1
            if score <= author_ticks:
                players[sid]["author"] += 1
                medalists += 1
        per_map.append({**m, "leaderboard_id": lid, "entries": len(entries),
                        "finishers": finishers, "author_medalists": medalists,
                        "creator_beat_own": creator_beat_own, "record": record})
        log(f"  {i:3d}/{len(maps)} {m['title'][:36]:36s} entries={len(entries):4d} author={medalists}")
        await asyncio.sleep(0.05)
    return players, per_map, failed


# ---------------------------------------------------------------- longest-standing records

OLDEST_RECORDS = 3
GHOST_STAMP_FORMAT = "%Y.%m.%d-%H.%M.%S"  # Unreal FDateTime, e.g. 2025.11.07-17.25.22
UGC_HANDLE_INVALID = str(2 ** 64 - 1)  # k_UGCHandleInvalid: the entry has no ghost attached
# A stamp this old was never really set: seen as a default-constructed FDateTime,
# "0001.01.01-00.00.00". Anything before the epoch also breaks time.mktime, so treat the
# whole range as undated rather than only the sentinel.
GHOST_STAMP_MIN_YEAR = 1970


async def campaign_records(client):
    """The rank-1 entry of every Circuit track: (board name, steam id, score, ugc id).
    Read by ID like the collector does; a board that fails to read is skipped."""
    records = []
    for name in cc.S1_TRACKS + cc.S2_TRACKS:
        try:
            msg = await client._state.ws.send_proto_and_wait(
                leaderboards.CMsgClientLbsGetLbEntries(
                    leaderboard_id=cc.LEADERBOARD_IDS[name], app_id=cc.APP_ID,
                    range_start=1, range_end=1, leaderboard_data_request=0, steamids=[],
                )
            )
            if msg.result != steam.Result.OK or not msg.entries:
                raise RuntimeError(f"LBSGetLBEntries result={msg.result!r}")
        except Exception as e:
            log(f"  [warn] {name}: record read failed: {e!r}")
            continue
        e = msg.entries[0]
        records.append({"board": name, "steam_id": str(e.steam_id_user), "score": int(e.score),
                        "ugc_id": str(e.ugc_id)})
        await asyncio.sleep(0.05)
    return records


def ghost_set_at(key, ugc_id):
    """When a record was set: the `timestamp` inside its ghost replay, as a UTC struct_time.

    Steam's entry carries no date; the ghost attached to it does. Two hops:
    GetUGCFileDetails for the CDN url, then the replay itself, which is plain JSON."""
    q = urllib.parse.urlencode({"key": key, "appid": cc.APP_ID, "ugcid": ugc_id})
    with urllib.request.urlopen(
            "https://api.steampowered.com/ISteamRemoteStorage/GetUGCFileDetails/v1/?" + q,
            timeout=60) as r:
        url = json.load(r)["data"]["url"]
    with urllib.request.urlopen(url, timeout=60) as r:
        stamp = json.load(r)["timestamp"]
    set_at = time.strptime(stamp, GHOST_STAMP_FORMAT)
    return set_at if set_at.tm_year >= GHOST_STAMP_MIN_YEAR else None


def date_record(key, rec, label):
    """A record's `set_at`, or None when it cannot be dated: no ghost attached, the
    ghost's timestamp never set, or the fetch failed. Each case is logged against
    `label` (the caller's name for the record) and leaves the record out of a ranking."""
    if rec["ugc_id"] == UGC_HANDLE_INVALID:
        log(f"  [note] {label}: record has no ghost replay, cannot be dated")
        return None
    try:
        set_at = ghost_set_at(key, rec["ugc_id"])
    except Exception as e:
        log(f"  [warn] {label}: ghost fetch failed: {e!r}")
        return None
    if set_at is None:
        log(f"  [note] {label}: record's ghost has no timestamp, cannot be dated")
    return set_at


def oldest_records(key, records, n=OLDEST_RECORDS):
    """The n longest-standing campaign records, oldest first, each with its `set_at`."""
    dated = []
    for rec in records:
        set_at = date_record(key, rec, rec["board"])
        if set_at:
            dated.append({**rec, "set_at": set_at})
    dated.sort(key=lambda r: r["set_at"])
    return dated[:n]


# A record's ghost may be stamped a little before the map's Workshop time_created (the
# creator's publishing run is driven before the upload completes), so a map is only
# skipped once it is this much younger than the oldest records found so far.
RECORD_BEFORE_PUBLISH_SLACK = 7 * 86400


def oldest_workshop_records(key, per_map, n=OLDEST_RECORDS):
    """The n longest-standing Workshop records, oldest first, each with its `map` and
    `set_at`. A map's record is its best counted finish (see collect). Dating means two
    HTTP hops per record, so instead of dating all ~700 the maps are walked oldest-first
    and the walk stops once every remaining map was published after the n-th oldest
    record found (a record cannot be much older than its map)."""
    dated = []
    for m in sorted((m for m in per_map if m["record"]), key=lambda m: m["created"]):
        if len(dated) >= n and m["created"] - RECORD_BEFORE_PUBLISH_SLACK > time.mktime(dated[n - 1]["set_at"]):
            break
        set_at = date_record(key, m["record"], repr(m["title"]))
        if not set_at:
            continue
        dated.append({**m["record"], "board": m["board"], "map": m, "set_at": set_at})
        dated.sort(key=lambda r: r["set_at"])
    return dated[:n]


# ---------------------------------------------------------------- Discord post

WORKSHOP_URL = "https://steamcommunity.com/sharedfiles/filedetails/?id="
# Widest a name gets in a table column: two columns of "NN  name NNNN" plus the gap come
# to ~58 chars, about what Discord shows in a code block on a phone unwrapped.
TABLE_NAME_WIDTH = 18
# The side-by-side position table, as (column header, stat, tie-breaking stat). Read both
# by the table and by the names to resolve, so a column cannot show an unresolved id.
POSITION_COLUMNS = [("World records", "wr", "top5"), ("Top 5s", "top5", "wr")]


def md_escape(s):
    """Neutralise Discord markdown and mentions in player names and map titles."""
    s = "".join("\\" + c if c in "\\*_~`|>[]" else c for c in s)
    return s.replace("@", "@​").replace("<", "<​")  # no @everyone / <@id> pings


def map_link(m):
    """Masked link to the map's Workshop page; the <> stop Discord unfurling an embed."""
    return f"[{md_escape(m['title'] or m['pfid'])}](<{WORKSHOP_URL}{m['pfid']}>)"


def ranked(players, key, top, then=None):
    """Top players by one stat as (steam_id, n), best first; ties broken by the `then`
    stat if given, and finally by id."""
    rows = sorted(((p[key], p[then] if then else 0, sid) for sid, p in players.items() if p[key] > 0),
                  key=lambda t: (-t[0], -t[1], t[2]))[:top]
    return [(sid, n) for n, _, sid in rows]


def build_sections(players, per_map, names, top, failed, oldest=(), oldest_ugc=()):
    """The "quote cards" layout chosen in the design round: each board is a quoted block
    with Discord's own numbered list inside, so the client draws the rank column and the
    bar. Discord renumbers list items sequentially whatever number is written, so ties
    cannot share a rank here; the written number is the row position.

    Returns the post as a list of sections (strings) for pack_messages to split."""
    def board(title, key, noun):
        lines = [f"> ### {title}"]
        for pos, (sid, n) in enumerate(ranked(players, key, top), 1):
            who = md_escape(names.get(sid, {}).get("persona") or sid)
            lines.append(f"> {pos}. **{who}** — {n} {noun}")
        if len(lines) == 1:
            lines.append("> _nobody yet_")
        return "\n".join(lines)

    def table(title, columns):
        """Several top lists side by side in one monospaced block, one per column:
        (header, stat, tiebreak stat). Names are clipped to TABLE_NAME_WIDTH so the
        rows stay on one line; markdown is inert inside a code block, so no escaping,
        but a backtick would end the block early and is swapped out."""
        cols = []
        for header, key, then in columns:
            rows = [(pos, names.get(sid, {}).get("persona") or sid, n)
                    for pos, (sid, n) in enumerate(ranked(players, key, top, then), 1)]
            cols.append((header, rows))
        height = max((len(rows) for _, rows in cols), default=0)
        width = 2 + 2 + TABLE_NAME_WIDTH + 1 + 4  # "NN  name… NNNN"

        def cell(header, rows, i):
            if i < 0:
                return f"{'#':>2}  {header:<{TABLE_NAME_WIDTH + 5}}"[:width]
            if i >= len(rows):
                return " " * width
            pos, who, n = rows[i]
            who = who.replace("`", "'")
            if len(who) > TABLE_NAME_WIDTH:
                who = who[:TABLE_NAME_WIDTH - 1] + "…"
            return f"{pos:>2}  {who:<{TABLE_NAME_WIDTH}} {n:>4}"

        body = ["  ".join(cell(h, r, i) for h, r in cols).rstrip() for i in range(-1, height)]
        lines = [f"> ### {title}", "> ```"] + ["> " + b for b in body] + ["> ```"]
        return "\n".join(lines) if height else f"> ### {title}\n> _nobody yet_"

    when = time.strftime("%-d %b %Y" if os.name != "nt" else "%#d %b %Y", time.gmtime())
    head = "\n".join(["# Custom Map Standings",
                      f"-# {len(per_map)} Workshop maps · {len(players):,} players · {when}"])

    # "Unbeaten" and "unclaimed" follow the same rule as the standings (see collect):
    # a creator's own entry is on the board only if it beats their own author time.
    # Both skip maps younger than LIST_MIN_AGE_SECONDS.
    listable = [m for m in per_map if time.time() - m["created"] >= LIST_MIN_AGE_SECONDS]
    unbeaten = sorted((m for m in listable if m["finishers"] == 0), key=lambda m: m["title"].lower())
    unclaimed = sorted((m for m in listable if m["finishers"] and not m["author_medalists"]),
                       key=lambda m: (-m["finishers"], m["title"].lower()))
    lines = ["> ### 🚫 Unbeaten maps", "> Nobody has finished these yet (maps up for at least a day)."]
    lines += [f"> - {map_link(m)}" for m in unbeaten] or ["> - _none — every map has been beaten_"]
    unbeaten_sec = "\n".join(lines)
    lines = ["> ### 🎯 Author medals still unclaimed",
             "> Finished, but nobody has matched the author time (maps up for at least a day)."]
    lines += [f"> - {map_link(m)} — {m['finishers']} finisher{'s' if m['finishers'] != 1 else ''}" for m in unclaimed] \
        or ["> - _none — every finished map has an author medal_"]
    unclaimed_sec = "\n".join(lines)

    # Circuit tracks are numbered per season, so the season has to lead the track name.
    def track(name):
        return "S" + dict(cc.BOARDS)[name].split()[-1] + " " + cc.display_name(name)

    today = time.gmtime()

    def record_line(pos, r, where):
        who = md_escape(names.get(r["steam_id"], {}).get("persona") or r["steam_id"])
        when = time.strftime("%-d %b %Y" if os.name != "nt" else "%#d %b %Y", r["set_at"])
        days = (time.mktime(today) - time.mktime(r["set_at"])) // 86400
        return f"> {pos}. **{who}** — {where} in {cc.fmt_time(r['score'])} — set {when} ({int(days)} days ago)"

    lines = ["> ### 🕰️ Longest-standing campaign records"]
    lines += [record_line(pos, r, track(r["board"])) for pos, r in enumerate(oldest, 1)]
    oldest_sec = "\n".join(lines) if oldest else ""
    lines = ["> ### 🕰️ Longest-standing Workshop records"]
    lines += [record_line(pos, r, map_link(r["map"])) for pos, r in enumerate(oldest_ugc, 1)]
    oldest_ugc_sec = "\n".join(lines) if oldest_ugc else ""

    foot = ("Creators count on their own maps only by beating their own author time. "
            "Maps must be > 24hr old to show up. Source: Steam leaderboards.")
    if failed:
        foot += f" ⚠️ {len(failed)} maps were unreadable this run."
    return [sec for sec in (head, board("🏁 Most maps beaten", "beaten", "maps"),
                            board("🏅 Most author medals", "author", "medals"),
                            table("🥇 Most world records · most top 5s", POSITION_COLUMNS),
                            unbeaten_sec, unclaimed_sec, oldest_sec, oldest_ugc_sec, "-# " + foot) if sec]


def split_lines(text, limit):
    """Split text between lines into pieces of at most `limit` chars."""
    pieces, cur = [], ""
    for line in text.split("\n"):
        cand = line if not cur else cur + "\n" + line
        if cur and len(cand) > limit:
            pieces.append(cur)
            cand = line
        cur = cand
    return pieces + [cur]


def pack_messages(sections, limit=DISCORD_MESSAGE_LIMIT):
    """Join sections with blank lines into as few messages as fit within Discord's
    limit (trailing newline included). A section stays whole where it can; one that is
    itself too long (a very long map list) is split between its lines."""
    messages, cur = [], ""
    for s in sections:
        for piece in split_lines(s, limit - 1):
            cand = piece if not cur else cur + "\n\n" + piece
            if cur and len(cand) + 1 > limit:
                messages.append(cur + "\n")
                cand = piece
            cur = cand
    if cur:
        messages.append(cur + "\n")
    return messages


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
    state = {"done": False, "result": None, "records": []}

    @client.event
    async def on_ready():
        if state["done"]:
            return
        state["done"] = True
        try:
            log("Reading leaderboards...")
            state["result"] = await collect(client, maps)
            log("Reading campaign records...")
            state["records"] = await campaign_records(client)
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

    log(f"Dating {len(state['records'])} campaign records from their ghosts...")
    oldest = oldest_records(key, state["records"])
    log("Dating the oldest Workshop records from their ghosts...")
    oldest_ugc = oldest_workshop_records(key, per_map)

    shown = {sid for k in ("beaten", "author") for sid, _ in ranked(players, k, args.top)}
    shown |= {sid for _, key, then in POSITION_COLUMNS
              for sid, _n in ranked(players, key, args.top, then)}
    shown |= {r["steam_id"] for r in (*oldest, *oldest_ugc)}
    log(f"Resolving {len(shown)} player names...")
    names = cc.resolve_names(key, shown)

    messages = pack_messages(build_sections(players, per_map, names, args.top, failed, oldest, oldest_ugc))
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
                       "maps": per_map,
                       "oldest_records": [{**r, "set_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", r["set_at"])}
                                          for r in oldest],
                       "oldest_workshop_records": [
                           {**r, "map": r["map"]["pfid"],
                            "set_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", r["set_at"])}
                           for r in oldest_ugc]}, f, ensure_ascii=False, indent=1)
        log(f"Wrote {args.json}")
    sys.stdout.reconfigure(encoding="utf-8")
    print(post, end="")
    if failed:
        log(f"WARNING: {len(failed)} map(s) unreadable; counts are incomplete: "
            f"{failed[:5]}{' ...' if len(failed) > 5 else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
