"""
One-off: replay the git history of data/ into the database as backfill Refreshes, so Score
history starts at the first committed snapshot (2026-09-05) rather than the day the
database write shipped (docs/adr/0005).

  DATABASE_URL=postgres://... python tools/db_backfill.py
  DATABASE_URL=postgres://... python tools/db_backfill.py --rebuild
  DATABASE_URL=postgres://... python tools/db_backfill.py --stats   # rows and size only

Walks every commit on HEAD's first-parent line that touched data/boards, data/workshop or
data/workshop.json, oldest first, and feeds each snapshot through db_writer.write_refresh,
the same writer the collector uses, as one Refresh with source 'backfill', dated at the
commit time and carrying its SHA. Each snapshot is its own transaction.

What a snapshot counts as read: every Circuit board in BOARDS that has a file (a derived
board, or one no longer in BOARDS such as the parked Map_TheTower, is skipped), and only
the Maps whose board file changed in that commit or first appears in it. A Map file that
did not change says nothing about whether the collector read it, so it is left unread,
as the collector leaves a Map it did not read. Map metadata comes from that commit's
workshop.json.

It runs from an empty database. It refuses one that already holds any Refresh, unless
given --rebuild, which truncates every table first and replays everything: the collector's
own Refreshes are in git as data commits too, so nothing is lost but their exact times.
"""

import os
import subprocess
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import json

import campaign_common as cc
import db_writer
import psycopg

PATHS = ("data/boards", "data/workshop", "data/workshop.json")
TABLES = (
    "entries",
    "board_reads",
    "persona_history",
    "map_history",
    "maps",
    "players",
    "boards",
    "refreshes",
)


def git(*args):
    return subprocess.run(  # noqa: S603 (git with our own arguments)
        ["git", "-C", cc.PROJ, *args],  # noqa: S607 (git from PATH)
        capture_output=True,
        text=True,
        check=True,
    ).stdout


class Blobs:
    """Reads blobs through one `git cat-file --batch`, parsed as JSON."""

    def __init__(self):
        self.proc = subprocess.Popen(  # noqa: S603 (git with our own arguments)
            ["git", "-C", cc.PROJ, "cat-file", "--batch"],  # noqa: S607 (git from PATH)
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
        )

    def read(self, sha):
        self.proc.stdin.write(sha.encode() + b"\n")
        self.proc.stdin.flush()
        _, kind, size = self.proc.stdout.readline().split()
        if kind != b"blob":
            raise RuntimeError(f"{sha} is a {kind!r}, not a blob")
        data = self.proc.stdout.read(int(size))
        self.proc.stdout.read(1)  # the newline after each object
        return json.loads(data)

    def close(self):
        self.proc.stdin.close()
        self.proc.wait()


def commits():
    """(sha, commit time) for every snapshot, oldest first."""
    out = git("log", "--first-parent", "--reverse", "--format=%H %cI", "--", *PATHS)
    return [
        (sha, datetime.fromisoformat(when))
        for sha, when in (line.split() for line in out.splitlines())
    ]


def tree(sha):
    """{path: blob sha} for the snapshot's data files."""
    out = git("ls-tree", "-r", sha, "--", *PATHS)
    return {
        path: meta.split()[2] for meta, path in (line.split("\t", 1) for line in out.splitlines())
    }


def snapshot(files, prev, blobs, cache):
    """The Refresh fields for one snapshot: (boards, workshop). files and prev are this
    and the previous snapshot's {path: blob}; cache holds parsed blobs by sha and keeps
    only this snapshot's."""

    def doc(path):
        sha = files[path]
        if sha not in cache:
            cache[sha] = blobs.read(sha)
        return cache[sha]

    boards = []
    for name, group in cc.BOARDS:
        path = f"data/boards/{name}.json"
        if path in files:
            b = doc(path)
            boards.append(
                {
                    "name": name,
                    "group": group,
                    "handle": b.get("handle"),
                    "entry_count": b.get("entry_count"),
                    "rows": b.get("rows") or [],
                }
            )
    workshop = None
    if "data/workshop.json" in files:
        maps = doc("data/workshop.json").get("maps", [])
        read = {}
        for m in maps:
            path = "data/" + m["file"] if m.get("file") else None
            if path in files and prev.get(path) != files[path]:
                read[m["pfid"]] = doc(path).get("rows") or []
        workshop = {"maps": maps, "boards": read, "failed": []}
    keep = set(files.values())
    for sha in [s for s in cache if s not in keep]:
        del cache[sha]
    return boards, workshop


def prepare(conn, *, rebuild):
    """Refuse a database that already holds Refreshes, unless rebuilding it."""
    held = dict(conn.execute("select source, count(*) from refreshes group by source").fetchall())
    if held and not rebuild:
        kinds = ", ".join(f"{n} {s}" for s, n in held.items())
        print(f"ERROR: the database already holds Refreshes ({kinds}). Rerun with --rebuild")
        print("to truncate every table and replay the whole history.")
        return False
    if held:
        print(f"Rebuilding: truncating {', '.join(TABLES)}")
        conn.execute(f"truncate {', '.join(TABLES)} restart identity")
    return True


def main(url, *, rebuild=False):
    began = time.monotonic()
    with psycopg.connect(url, autocommit=True) as conn:
        if not prepare(conn, rebuild=rebuild):
            return 2
        snaps = commits()
        print(f"Replaying {len(snaps)} snapshots of data/ ...")
        blobs, cache, prev = Blobs(), {}, {}
        try:
            for i, (sha, when) in enumerate(snaps, 1):
                files = tree(sha)
                boards, workshop = snapshot(files, prev, blobs, cache)
                rid = db_writer.write_refresh(
                    conn,
                    db_writer.Refresh(
                        started_at=when,
                        finished_at=when,
                        boards=boards,
                        workshop=workshop,
                        source="backfill",
                        commit_sha=sha,
                    ),
                )
                # Each Refresh rewrites last_seen on every open Entry; vacuuming between
                # snapshots lets the next one reuse that space instead of growing the
                # database several times past its real size (autovacuum lags a replay).
                conn.execute("vacuum entries")
                maps_read = len(workshop["boards"]) if workshop else 0
                print(
                    f"  [{i}/{len(snaps)}] {sha[:9]} {when:%Y-%m-%d %H:%M%z} Refresh {rid}: "
                    f"{len(boards)} Circuit boards, {maps_read} Maps read"
                    f"  ({time.monotonic() - began:.0f}s)"
                )
                prev = files
        finally:
            blobs.close()
    print(f"Done in {time.monotonic() - began:.0f}s")
    return stats(url)


def stats(url):
    """Rows per table and the database's size (Neon's free tier holds 0.5 GB)."""
    with psycopg.connect(url, autocommit=True) as conn:
        for table in TABLES:
            (n,) = conn.execute(f"select count(*) from {table}").fetchone()  # noqa: S608 (our table names)
            print(f"  {table:16s} {n:9d} rows")
        (size, pretty) = conn.execute(
            "select pg_database_size(current_database()),"
            " pg_size_pretty(pg_database_size(current_database()))"
        ).fetchone()
        print(f"  database size    {pretty} ({size} bytes)")
    return 0


if __name__ == "__main__":
    if not os.environ.get("DATABASE_URL"):
        print("ERROR: DATABASE_URL is not set")
        sys.exit(2)
    url = os.environ["DATABASE_URL"]
    if "--stats" in sys.argv[1:]:
        sys.exit(stats(url))
    sys.exit(main(url, rebuild="--rebuild" in sys.argv[1:]))
