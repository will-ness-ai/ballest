"""
The collector's Ghost step: each run's Ghost (the replay Steam stores with a score, by its
UGC ID) names the ball skin the run was rolled with, which the boards draw (docs/data.md,
"Ghosts").

After the database write, `record_ghosts` picks the open Entries in the top TOP of every
time board whose UGC ID has no `ghosts` row, best rank first (`due`), reads each through
the Steam Web API (`read`: GetUGCFileDetails, then the file's CDN URL; only the first call
counts toward the key's daily quota), a few at once, and stops at BUDGET with what it has
(`collect`). A Ghost never changes, so each is read once ever. A read that fails writes
nothing and is tried again next Refresh; only Steam saying the file is gone, or a Ghost
with no samples, is final without a skin. The step never raises: a failure is a warning,
and the Refresh it follows is already written.
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import UTC, datetime

import campaign_common as cc
import db_writer
import psycopg

# the top of each time board whose Ghosts are read: two of a board's first pages
TOP = 100
# reads at once, and the step's wall-clock limit; the backlog waits for the next Refresh
WORKERS = 8
BUDGET = 240.0
# a UGC ID Steam uses for "no file" (old Workshop records)
NO_UGC = str(2**64 - 1)
DETAILS = "https://api.steampowered.com/ISteamRemoteStorage/GetUGCFileDetails/v1/?"


@dataclass(frozen=True)
class Ghost:
    ugc_id: str
    state: str  # ok, empty, gone
    skin: str | None = None
    hat: str | None = None


class GoneError(Exception):
    """Steam has no file for this UGC ID: final, unlike any other failed read."""


def object_path(written):
    """The object path a Ghost writes as `/Script/Engine.Class'/Game/Path.Name'`, or None
    for "None" or nothing (ghostdata::ObjectPath in the plugin host does the same)."""
    if not isinstance(written, str):
        return None
    a, b = written.find("'"), written.rfind("'")
    path = written[a + 1 : b] if 0 <= a < b else written
    return None if path in ("", "None") else path


def parse(ugc_id, ghost):
    """A Ghost's JSON as a row. The skin is its material, or for a skin with no material
    (Snow Globe) its actor class. Ghosts from before about 2026-01 have no
    `?SpecialSkinClass`, and those with no samples write every field as "None"."""
    if not ghost.get("elapsedTime"):
        return Ghost(ugc_id, "empty")
    skin = object_path(ghost.get("skinMaterial")) or object_path(ghost.get("?SpecialSkinClass"))
    return Ghost(ugc_id, "ok", skin, object_path(ghost.get("accessory")))


def _get_json(url):
    with urllib.request.urlopen(url, timeout=30) as r:  # noqa: S310 (Steam's https URLs)
        return json.loads(r.read())


def read(key, ugc_id, get=_get_json):
    """One Ghost from Steam, as a row. Raises GoneError when Steam has no file for it, and any
    other error for a read to try again. Steam answers a missing file with HTTP 404 and its
    status in the body ({"status":{"code":9}}), so only that request's 404 is read as an
    answer; an error from the CDN is always a failed read."""
    q = urllib.parse.urlencode({"key": key, "appid": cc.APP_ID, "ugcid": ugc_id})
    try:
        details = get(DETAILS + q)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        try:
            details = json.loads(e.read())
        except ValueError:
            raise e from None
    url = (details.get("data") or {}).get("url")
    if not url:
        if (details.get("status") or {}).get("code") == 9:  # k_EResultFileNotFound
            raise GoneError(ugc_id)
        raise RuntimeError(f"no file URL for {ugc_id}: {str(details)[:200]}")
    return parse(ugc_id, get(url))


def due(conn, limit=None):
    """UGC IDs to read: on every time board, the open Entries ranked within TOP that have a
    Ghost and no `ghosts` row, best rank first, so a short budget reads the top first."""
    with conn.cursor() as cur:
        found = cur.execute(
            """
            select ugc_id from (
              select e.ugc_id, row_number() over (
                partition by e.board order by e.score, e.steam_id) as rank
              from entries e join boards b on b.name = e.board
              where e.closed_refresh is null and not b.scores_points
            ) r
            where rank <= %s and ugc_id is not null and ugc_id <> %s
              and not exists (select 1 from ghosts g where g.ugc_id = r.ugc_id)
            group by ugc_id
            order by min(rank), ugc_id
            limit %s
            """,
            (TOP, NO_UGC, limit),
        ).fetchall()
    return [r[0] for r in found]


def collect(ugc_ids, read_one, *, budget=BUDGET, workers=WORKERS, clock=time.monotonic):
    """Read `ugc_ids` with read_one, `workers` at once, until done or `budget` seconds
    pass. Returns (rows, failed): a row per Ghost read or gone, and how many reads failed
    of each error, by its type's name. No read starts after the budget; one still running
    then is abandoned and one that has finished is kept, though the interpreter still lets
    an abandoned read run out its timeouts before the collector exits."""
    end = clock() + budget
    rows, failed = [], Counter()
    todo = iter(ugc_ids)
    pool = ThreadPoolExecutor(max_workers=workers)
    running = {}

    def take(done):
        for f in done:
            u = running.pop(f)
            try:
                rows.append(f.result())
            except GoneError:
                rows.append(Ghost(u, "gone"))
            except Exception as e:
                failed[type(e).__name__] += 1

    try:
        while True:
            while len(running) < workers and clock() < end:
                u = next(todo, None)
                if u is None:
                    break
                running[pool.submit(read_one, u)] = u
            if not running:
                break
            left = end - clock()
            if left <= 0:
                take([f for f in running if f.done()])
                break
            take(wait(running, timeout=left, return_when=FIRST_COMPLETED)[0])
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return rows, failed


def write(conn, rows, read_at):
    """The Ghosts read, in one transaction. A row is final, so one already there stays."""
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into ghosts (ugc_id, state, skin, hat, read_at)
            values (%s, %s, %s, %s, %s) on conflict (ugc_id) do nothing
            """,
            [(g.ugc_id, g.state, g.skin, g.hat, read_at) for g in rows],
        )
    conn.commit()


def record_ghosts(*, scratch=False, env=None, key=None, read_one=None):
    """The Ghost step, after the Refresh is in the database. Returns how many Ghosts it
    wrote, or None when it was skipped or failed. Never raises. Revalidates the site when
    it wrote any, since the boards draw them."""
    env = os.environ if env is None else env
    url = db_writer.database_url(env, scratch=scratch)
    key = key or cc.load_key()
    if not (url and key):
        print("Ghosts: no database or STEAM_API_KEY; skipping the Ghost step")
        return None
    read_one = read_one or (lambda u: read(key, u))
    try:
        with psycopg.connect(url, connect_timeout=30) as conn:
            todo = due(conn)
            rows, failed = collect(todo, read_one)
            write(conn, rows, datetime.now(UTC))
    except Exception as e:
        print(f"::warning::Ghost step failed: {type(e).__name__}")
        return None
    n_failed = sum(failed.values())
    left = len(todo) - len(rows) - n_failed
    why = ", ".join(f"{k} {v}" for k, v in failed.most_common())
    print(
        f"Ghosts: {len(todo)} due, {len(rows)} written, {n_failed} failed"
        + (f" ({why})" if why else "")
        + (f", {left} left for the next Refresh" if left else "")
    )
    if rows:
        db_writer.revalidate(env)
    return len(rows)
