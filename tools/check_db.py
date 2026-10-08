"""
Dual-write parity: the database's open Entries against the JSON the same Refresh wrote.

While the collector writes both (docs/adr/0005), every board's open Entries in the
database must be exactly the (steam_id, score) pairs of its committed board file: the
Circuit boards in data/boards/ (the derived ones, which the database does not store,
aside) and every Map's file that data/workshop.json lists. Exit status is non-zero on any
drift, so the refresh workflow turns red when the two disagree.

  DATABASE_URL=postgres://... python tools/check_db.py
  DATABASE_URL=postgres://... python tools/check_db.py --data scratch/data

A Map gone from the Workshop has its file removed from data/ while the database keeps its
Entries open (nothing closes a board that was not read), so a stored Map that
workshop.json no longer lists is reported but is not drift.
"""

import json
import os
import sys
from datetime import UTC

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc
import psycopg

SHOW = 5  # differing players listed per board


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def by_player(rows):
    """{steam_id: score} for a board file's rows; a repeated player keeps the first
    (better-ranked) row, as db_writer does."""
    out = {}
    for r in rows:
        out.setdefault(r["steam_id"], int(r["score_ms"]))
    return out


def json_boards():
    """(boards, listed pfids): {board name: {steam_id: score}} from the committed files."""
    out = {}
    for name, _ in cc.BOARDS:
        path = os.path.join(cc.BOARDS_DIR, name + ".json")
        if os.path.exists(path):
            out[name] = by_player(load(path).get("rows") or [])
    ws = cc.load_workshop() or {}
    pfids = set()
    for m in ws.get("maps", []):
        pfids.add(m["pfid"])
        if m.get("file"):
            path = os.path.join(cc.DATA_DIR, m["file"])
            out[m["name"]] = by_player(load(path).get("rows") or []) if os.path.exists(path) else {}
    return out, pfids


def db_boards(conn):
    """Every stored board's open Entries, but a Daily's: Dailies are database-only, so
    there is no file to compare them with (docs/data.md)."""
    out = {name: {} for (name,) in conn.execute("select name from boards where kind <> 'daily'")}
    for board, sid, score in conn.execute(
        "select e.board, e.steam_id, e.score from entries e join boards b on b.name = e.board"
        " where e.closed_refresh is null and b.kind <> 'daily'"
    ):
        out[board][sid] = score
    return out


def compare(want, have, listed):
    """Every drift between the files (want) and the database (have), as lines."""
    problems = []
    for name, rows in want.items():
        if name not in have:
            problems.append(f"{name}: has a board file but is not in the database")
            continue
        got = have[name]
        if got == rows:
            continue
        missing = [s for s in rows if s not in got]
        extra = [s for s in got if s not in rows]
        changed = [s for s in rows if s in got and got[s] != rows[s]]
        detail = "; ".join(
            f"{label} {len(ids)} ({', '.join(ids[:SHOW])})"
            for label, ids in (("missing", missing), ("extra", extra), ("score differs", changed))
            if ids
        )
        problems.append(f"{name}: file has {len(rows)}, database {len(got)} open: {detail}")
    for name, got in have.items():
        if name in want or not got:
            continue
        if name.startswith("Workshop_") and name[len("Workshop_") :] not in listed:
            print(f"  note: {name} is gone from the Workshop; {len(got)} Entries stay open")
            continue
        problems.append(f"{name}: {len(got)} open Entries in the database but no board file")
    return problems


def main(url):
    want, listed = json_boards()
    with psycopg.connect(url, connect_timeout=30) as conn:
        last = conn.execute(
            "select id, source, started_at from refreshes order by id desc limit 1"
        ).fetchone()
        have = db_boards(conn)
    if not last:
        print("FAILED: the database holds no Refresh")
        return 1
    print(f"  latest Refresh {last[0]} ({last[1]}, {last[2].astimezone(UTC):%Y-%m-%dT%H:%MZ})")
    problems = compare(want, have, listed)
    if problems:
        print(f"\nFAILED: {len(problems)} board(s) drift between the database and the JSON:")
        for p in problems:
            print("  - " + p)
        return 1
    rows = sum(len(r) for r in want.values())
    print(f"\nOK: {len(want)} boards, {rows} open Entries match the JSON")
    return 0


if __name__ == "__main__":
    if "--data" in sys.argv[1:]:
        cc.use_data_dir(sys.argv[sys.argv.index("--data") + 1])
    if not os.environ.get("DATABASE_URL"):
        print("ERROR: DATABASE_URL is not set")
        sys.exit(2)
    sys.exit(main(os.environ["DATABASE_URL"]))
