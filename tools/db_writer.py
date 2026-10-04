"""
The collector's database writer: one Refresh into Postgres as change-only Score history
(docs/adr/0005, the tables in docs/data.md, the schema in web/db/schema.ts).

write_refresh is the one entry point that changes the database. It takes a Refresh as the
collector holds it after its guards have run, and writes it in one transaction:

  - the Refresh itself, then every board it carries (Tracks, Overall boards, each Map's)
  - board_reads: a row per board read, ok or not. A board the collector kept from the
    committed copy (Refresh.reused), a Map whose read failed, and a board that came back
    empty are all ok=false, and their Entries are left exactly as they were. A Map the
    Workshop step did not read has no row at all.
  - for each board read ok: an open Entry whose score is unchanged only moves
    last_seen_refresh; a changed score closes the old Entry and opens a new one; a new
    player opens one; a player no longer on the board has theirs closed, never deleted.
    A points (Overall) board is the exception: a changed score updates its open Entry in
    place, so it holds current points only.
  - players and persona_history, maps and map_history: upserted, with a history row
    appended only when something in it changed (otherwise its last_seen_refresh moves).

The derived boards (Season 1 Current, All Seasons) are never stored: they come from these
rows. A score is the raw score_ms, ticks (SCORE_TICKS_PER_SECOND) on a time board and
points on an Overall one; nothing here converts it.

Set-based throughout, because a Refresh carries ~155k rows across ~1,100 boards: rows go
into temp tables by COPY and each step is one statement over them.

record_refresh wraps write_refresh for the collector: picks the database, never lets a
database failure stop the JSON write, and revalidates the site after a commit.
"""

import os
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime

import campaign_common as cc
import psycopg

# Built by the collector from Steam's boards, so stored only as the rows they come from.
DERIVED_BOARDS = frozenset({cc.S1_CURRENT_BOARD, cc.COMPOSITE_BOARD})


@dataclass
class Refresh:
    """What one Refresh read, as the collector holds it once its guards have run.

    boards: Circuit boards ({"name", "group", "entry_count", "rows"}), rows as board_rows
      makes them with names filled in. A derived board here is skipped.
    reused: names in boards whose read failed and whose rows are the committed copy.
    workshop: what collect_workshop returned, if the Workshop files were published this
      Refresh: {"maps": [...], "boards": {pfid: rows read}, "failed": [pfid, ...]}. None
      when the Workshop step failed or its guards kept the committed files, and then no
      Map counts as read.
    """

    started_at: datetime
    boards: list = field(default_factory=list)
    reused: tuple = ()
    workshop: dict | None = None
    source: str = "collector"
    commit_sha: str | None = None
    finished_at: datetime | None = None


def database_url(env, *, scratch=False):
    """The database this run writes, or None to skip the step. A run with --out (scratch)
    writes only DEV_DATABASE_URL, never DATABASE_URL, so a feature branch can't touch
    production, and a DEV_DATABASE_URL equal to DATABASE_URL counts as unset."""
    if scratch:
        dev = env.get("DEV_DATABASE_URL")
        return dev if dev and dev != env.get("DATABASE_URL") else None
    return env.get("DATABASE_URL") or None


def record_refresh(refresh, *, scratch=False, env=None):
    """The collector's database step, after the JSON is written. Returns the Refresh's ID,
    or None when it was skipped or failed. It never raises: the JSON is still the source
    while the collector writes both, so a database failure is a GitHub ::error:: line and
    the run goes on, and the parity check after the commit (check_db.py) turns the job
    red. After a commit, revalidates the site's cached reads."""
    env = os.environ if env is None else env
    url = database_url(env, scratch=scratch)
    if not url:
        var = "DEV_DATABASE_URL" if scratch else "DATABASE_URL"
        print(f"Database: no {var}; skipping the database write")
        return None
    try:
        with psycopg.connect(url, connect_timeout=30) as conn:
            rid = write_refresh(conn, refresh)
    except Exception as e:
        print(f"::error::Database write failed; the JSON is written regardless: {e!r}")
        return None
    print(f"Database: wrote Refresh {rid}")
    revalidate(env)
    return rid


def revalidate(env):
    """POST ${SITE_URL}/api/revalidate so the site's reads tagged "data" refetch. Skipped
    without SITE_URL and REVALIDATE_SECRET; a failure is only a warning."""
    site, secret = env.get("SITE_URL"), env.get("REVALIDATE_SECRET")
    if not (site and secret):
        print("Database: no SITE_URL/REVALIDATE_SECRET; not revalidating the site")
        return
    req = urllib.request.Request(  # noqa: S310 (SITE_URL is ours, from the workflow)
        site.rstrip("/") + "/api/revalidate",
        method="POST",
        headers={"Authorization": "Bearer " + secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 (as above)
            print(f"Database: revalidated the site ({r.status})")
    except Exception as e:
        print(f"::warning::Revalidating the site failed: {e!r}")


def board_kind(name):
    """The board's kind from its name, as isPoints in index.html reads it."""
    return "overall" if name.startswith("Overall") else "track"


def _nz(v):
    return v or None


def _copy(cur, table, cols, rows):
    """A temp table named table, filled by COPY. Dropped when the transaction ends."""
    cur.execute(f"create temp table {table} ({cols}) on commit drop")
    names = ", ".join(c.split()[0] for c in cols.split(", "))
    with cur.copy(f"copy {table} ({names}) from stdin") as cp:
        for r in rows:
            cp.write_row(r)


def _gather(refresh):
    """(boards, reads, entries, players, maps) as plain tuples, from the Refresh."""
    reused = set(refresh.reused)
    boards, reads, read_rows = [], [], []
    for b in refresh.boards:
        name = b["name"]
        if name in DERIVED_BOARDS:
            continue
        lid = cc.LEADERBOARD_IDS.get(name) or (int(b["handle"]) if b.get("handle") else None)
        kind = board_kind(name)
        boards.append((name, kind, b.get("group"), cc.display_name(name), lid, kind == "overall"))
        # An empty read is a failed read: it must never close a whole board's Entries.
        ok = name not in reused and bool(b["rows"])
        reads.append((name, ok, b.get("entry_count") if ok else None))
        read_rows.append((name, b["rows"], ok))
    maps = []
    ws = refresh.workshop
    if ws:
        listed = {}
        for m in ws["maps"]:
            listed[m["pfid"]] = m
            lid = int(m["handle"]) if m.get("handle") else None
            boards.append((m["name"], "map", None, m["display"], lid, False))
            maps.append(m)
        for pfid, rows in ws.get("boards", {}).items():
            m = listed.get(pfid)
            if not m:
                continue
            reads.append((m["name"], bool(rows), m.get("entry_count") if rows else None))
            read_rows.append((m["name"], rows, bool(rows)))
        reads.extend(
            (listed[pfid]["name"], False, None)
            for pfid in ws.get("failed", [])
            if pfid in listed and pfid not in ws.get("boards", {})
        )

    players, entries = {}, {}
    for name, rows, ok in read_rows:
        for r in rows:
            sid = r["steam_id"]
            p = players.get(sid)
            if not p or (not p[1] and r.get("persona")):
                players[sid] = (
                    sid,
                    r.get("persona") or "",
                    _nz(r.get("avatar")),
                    _nz(r.get("profileurl")),
                )
            if ok:
                # rank order, so a player listed twice keeps their better row
                ugc = r.get("ugc_id")
                entries.setdefault(
                    (name, sid), (name, sid, int(r["score_ms"]), None if ugc in ("", "0") else ugc)
                )
    # one row per board and Map: the upserts below would refuse a name given twice
    boards = list({b[0]: b for b in boards}.values())
    maps = list({m["pfid"]: m for m in maps}.values())
    reads = list({r[0]: r for r in reversed(reads)}.values())
    return boards, reads, list(entries.values()), list(players.values()), maps


def write_refresh(conn, refresh):
    """Write one Refresh in one transaction and return its ID. Any error rolls back the
    whole Refresh, leaving the database as it was.

    conn must be outside a transaction (fresh, or autocommit): inside one, psycopg would
    make this a savepoint, and nothing would be committed until the caller did."""
    if conn.info.transaction_status != psycopg.pq.TransactionStatus.IDLE:
        raise RuntimeError("write_refresh needs a connection outside a transaction")
    boards, reads, entries, players, maps = _gather(refresh)
    with conn.transaction(), conn.cursor() as cur:
        (rid,) = cur.execute(
            "insert into refreshes (started_at, source, commit_sha) values (%s, %s, %s)"
            " returning id",
            (refresh.started_at, refresh.source, refresh.commit_sha),
        ).fetchone()

        _copy(
            cur,
            "in_boards",
            "name text, kind board_kind, season text, display text, leaderboard_id bigint,"
            " scores_points boolean",
            boards,
        )
        cur.execute(
            """
            insert into boards (name, kind, season, display, leaderboard_id, scores_points)
            select name, kind, season, display, leaderboard_id, scores_points from in_boards
            on conflict (name) do update set
              kind = excluded.kind, season = excluded.season, display = excluded.display,
              leaderboard_id = coalesce(excluded.leaderboard_id, boards.leaderboard_id),
              scores_points = excluded.scores_points
            """
        )
        _copy(cur, "in_reads", "board text, ok boolean, entry_count integer", reads)
        cur.execute(
            "insert into board_reads (refresh_id, board, ok, entry_count)"
            " select %s, board, ok, entry_count from in_reads",
            (rid,),
        )

        _write_players(cur, rid, players)
        _write_entries(cur, rid, entries)
        if maps:
            _write_maps(cur, rid, maps)

        cur.execute(
            "update refreshes set finished_at = coalesce(%s, clock_timestamp()) where id = %s",
            (refresh.finished_at, rid),
        )
    return rid


def _write_players(cur, rid, players):
    _copy(cur, "in_players", "steam_id text, persona text, avatar text, profile_url text", players)
    # A blank persona or picture (a failed name lookup) never overwrites a known one.
    cur.execute(
        """
        insert into players (steam_id, persona, avatar, profile_url)
        select steam_id, persona, avatar, profile_url from in_players
        on conflict (steam_id) do update set
          persona = coalesce(nullif(excluded.persona, ''), players.persona),
          avatar = coalesce(excluded.avatar, players.avatar),
          profile_url = coalesce(excluded.profile_url, players.profile_url)
        """
    )
    cur.execute(
        """
        create temp table last_persona on commit drop as
        select distinct on (steam_id) id, steam_id, persona from persona_history
        order by steam_id, id desc
        """
    )
    cur.execute(
        """
        update persona_history h set last_seen_refresh = %s
        from last_persona l join in_players i using (steam_id)
        where h.id = l.id and i.persona = l.persona
        """,
        (rid,),
    )
    cur.execute(
        """
        insert into persona_history (steam_id, persona, first_seen_refresh, last_seen_refresh)
        select i.steam_id, i.persona, %s, %s from in_players i
        left join last_persona l using (steam_id)
        where i.persona <> '' and (l.persona is null or l.persona <> i.persona)
        """,
        (rid, rid),
    )


def _write_entries(cur, rid, entries):
    _copy(cur, "in_entries", "board text, steam_id text, score bigint, ugc_id text", entries)
    cur.execute("create index on in_entries (board, steam_id)")
    cur.execute("analyze in_entries")
    # Only boards read ok this Refresh are touched: a failed, kept or empty read moves
    # nothing, and a Map not read has no row in in_reads at all.
    # A points board keeps current points only: its open Entry takes the new score in
    # place, since Overall points move for most players every Refresh and would outgrow
    # the database (docs/adr/0005). Its history comes from the tracks'.
    cur.execute(
        """
        update entries e set score = i.score, ugc_id = i.ugc_id
        from in_entries i, boards b
        where e.closed_refresh is null and e.board = i.board and e.steam_id = i.steam_id
          and b.name = i.board and b.scores_points and e.score <> i.score
          and e.board in (select board from in_reads where ok)
        """
    )
    cur.execute(
        """
        update entries e set closed_refresh = %s
        where e.closed_refresh is null
          and e.board in (select board from in_reads where ok)
          and not exists (
            select 1 from in_entries i
            where i.board = e.board and i.steam_id = e.steam_id and i.score = e.score)
        """,
        (rid,),
    )
    cur.execute(
        """
        update entries e set last_seen_refresh = %s
        from in_entries i
        where e.closed_refresh is null and e.board = i.board and e.steam_id = i.steam_id
        """,
        (rid,),
    )
    cur.execute(
        """
        insert into entries (board, steam_id, score, ugc_id, first_seen_refresh, last_seen_refresh)
        select i.board, i.steam_id, i.score, i.ugc_id, %s, %s from in_entries i
        where not exists (
          select 1 from entries e
          where e.board = i.board and e.steam_id = i.steam_id and e.closed_refresh is null)
        """,
        (rid, rid),
    )


def _write_maps(cur, rid, maps):
    _copy(
        cur,
        "in_maps",
        "pfid text, board text, creator_steam_id text, created bigint, title text,"
        " creator text, preview text, medals float8[], sessions integer, subs integer,"
        " entry_count integer",
        [
            (
                m["pfid"],
                m["name"],
                _nz(m.get("cid")),
                m.get("created") or None,
                m["display"],
                _nz(m.get("creator")),
                _nz(m.get("preview")),
                m.get("medals"),
                m.get("sessions"),
                m.get("subs"),
                m.get("entry_count"),
            )
            for m in maps
        ],
    )
    cur.execute(
        """
        insert into maps (pfid, board, creator_steam_id, created_at)
        select pfid, board, creator_steam_id, to_timestamp(created) from in_maps
        on conflict (pfid) do update set
          creator_steam_id = coalesce(excluded.creator_steam_id, maps.creator_steam_id),
          created_at = coalesce(excluded.created_at, maps.created_at)
        """
    )
    cur.execute(
        """
        create temp table last_map on commit drop as
        select distinct on (pfid) * from map_history order by pfid, id desc
        """
    )
    same = """
        i.title = l.title and i.creator is not distinct from l.creator
        and i.preview is not distinct from l.preview and i.medals is not distinct from l.medals
        and i.sessions is not distinct from l.sessions and i.subs is not distinct from l.subs
        and i.entry_count is not distinct from l.entry_count
    """
    cur.execute(
        f"""
        update map_history h set last_seen_refresh = %s
        from last_map l join in_maps i using (pfid)
        where h.id = l.id and {same}
        """,  # noqa: S608 (a fixed fragment, no input in it)
        (rid,),
    )
    cur.execute(
        f"""
        insert into map_history (pfid, title, creator, preview, medals, sessions, subs,
          entry_count, first_seen_refresh, last_seen_refresh)
        select i.pfid, i.title, i.creator, i.preview, i.medals, i.sessions, i.subs,
          i.entry_count, %s, %s
        from in_maps i left join last_map l using (pfid)
        where l.id is null or not ({same})
        """,  # noqa: S608 (a fixed fragment, no input in it)
        (rid, rid),
    )
