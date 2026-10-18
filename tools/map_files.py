"""
The collector's Map file step: keeps every Workshop Map's file (its .ballmap) in the
`map_files` table, which the site's 3D view draws (docs/data.md, "Map files"; ADR 0010).

After the database write and the Ghost step, while the steam.py client is still connected,
`record_map_files` picks every catalogue Map whose stored version (the catalogue's
`hcontent_file`) differs or is missing, most subscribed first (`due`), downloads each
through steam.py (`steam_download`: its published file, its manifest, and the file in it
that starts like JSON, `map_file`), a few at once, and writes each gzip-compressed as it
arrives, so a budget stop or a later failure keeps what was written (`collect`). No
download starts after BUDGET; the rest wait for the next Refresh. A failed download, or a
manifest with no map file, writes nothing and is tried again next run. The step never
raises: a failure is a warning, and the Refresh it follows is already written.

Run on its own (`python tools/map_files.py [--budget SECONDS] [--dev]`, by hand through
`.github/workflows/map-files.yml`), it logs into Steam, takes the catalogue and downloads
every due Map within the longer budget, to fill a backlog without waiting on Refreshes.
"""

import argparse
import asyncio
import gzip
import os
import sys
import time
from asyncio import FIRST_COMPLETED
from collections import Counter
from datetime import UTC, datetime

import campaign_common as cc
import db_writer
import psycopg
import steam

# downloads at once, and the step's wall-clock limit; the backlog waits for the next Refresh
WORKERS = 4
BUDGET = 240.0
# how a .ballmap starts: JSON ("{\n\t"worldSettings"" in every file captured so far), or a
# UTF-8 BOM before it, which a JSON file may carry though none captured so far does
MAP_FILE_STARTS = (b"{", b"\xef\xbb\xbf")


class NoMapFileError(Exception):
    """The Map's manifest holds no file that starts like a .ballmap."""


def map_file(files):
    """The .ballmap among a manifest's files (as bytes): the one that starts like JSON. The
    manifest also holds the preview picture."""
    for data in files:
        if data.startswith(MAP_FILE_STARTS):
            return data
    raise NoMapFileError


def due(conn, catalogue):
    """The catalogue Maps whose file to download: those with no stored file or one of another
    version, most subscribed first, so a short budget reaches the busiest Maps first."""
    with conn.cursor() as cur:
        held = dict(cur.execute("select pfid, version from map_files").fetchall())
    todo = [
        m
        for m in catalogue
        if m.get("version") not in (None, "", "0") and held.get(m["pfid"]) != m["version"]
    ]
    return sorted(todo, key=lambda m: (-m["subs"], m["pfid"]))


async def collect(conn, todo, download, *, budget=BUDGET, workers=WORKERS, clock=time.monotonic):
    """Download the Maps in `todo` (catalogue Maps) with `download` (pfid -> the file's
    bytes), `workers` at once, writing each file as it arrives, until done or `budget`
    seconds pass. Returns (written, failed): how many files it wrote, and how many downloads
    failed of each error, by its type's name. No download starts after the budget, and one
    still running then is cancelled; a failed one writes nothing, so it is due next run."""
    end = clock() + budget
    written, failed = 0, Counter()
    todo = iter(todo)
    running = {}

    async def take(done):
        nonlocal written
        for task in done:
            m = running.pop(task)
            try:
                data = task.result()
            except NoMapFileError:
                failed["NoMapFileError"] += 1
                print(f"  [warn] Map {m['pfid']} {m.get('title')!r}: no map file in its manifest")
                continue
            except Exception as e:
                failed[type(e).__name__] += 1
                continue
            await asyncio.to_thread(write, conn, m, data, datetime.now(UTC))
            written += 1

    try:
        while True:
            while len(running) < workers and clock() < end:
                m = next(todo, None)
                if m is None:
                    break
                running[asyncio.ensure_future(download(m["pfid"]))] = m
            if not running:
                break
            left = end - clock()
            if left <= 0:
                await take([t for t in running if t.done()])
                break
            done, _ = await asyncio.wait(running, timeout=left, return_when=FIRST_COMPLETED)
            await take(done)
    finally:
        for task in running:
            task.cancel()
    return written, failed


def write(conn, m, data, read_at):
    """One Map's file, gzip-compressed, replacing any older version, committed at once so a
    later failure or the budget keeps it."""
    conn.execute(
        """
        insert into map_files (pfid, version, raw_size, gzipped, read_at)
        values (%s, %s, %s, %s, %s)
        on conflict (pfid) do update set
          version = excluded.version, raw_size = excluded.raw_size,
          gzipped = excluded.gzipped, read_at = excluded.read_at
        """,
        (m["pfid"], m["version"], len(data), gzip.compress(data, mtime=0), read_at),
    )
    conn.commit()


def steam_download(client):
    """The download the collector uses: a Map's file through the connected steam.py client
    (its published file, its manifest, then each file's bytes from Steam's content servers),
    as map_file picks it."""

    async def download(pfid):
        (found,) = await client.fetch_published_files(int(pfid)) or [None]
        if found is None:
            raise LookupError(pfid)
        manifest = await found.manifest()
        return map_file([await p.read_bytes() for p in manifest.paths if p.is_file()])

    return download


async def record_map_files(catalogue, download, *, scratch=False, env=None, budget=BUDGET):
    """The Map file step, after the Refresh is in the database, while the Steam client is
    still connected. Returns how many files it wrote, or None when it was skipped or failed.
    Never raises. Revalidates the site when it wrote any, since the Map pages offer the 3D
    view only for a Map whose file is held."""
    env = os.environ if env is None else env
    url = db_writer.database_url(env, scratch=scratch)
    if not (url and catalogue):
        print("Map files: no database or Workshop catalogue; skipping the Map file step")
        return None
    try:
        conn = await asyncio.to_thread(psycopg.connect, url, connect_timeout=30)
        try:
            todo = await asyncio.to_thread(due, conn, catalogue)
            written, failed = await collect(conn, todo, download, budget=budget)
        finally:
            await asyncio.to_thread(conn.close)
    except Exception as e:
        print(f"::warning::Map file step failed: {type(e).__name__}")
        return None
    n_failed = sum(failed.values())
    left = len(todo) - written - n_failed
    why = ", ".join(f"{k} {v}" for k, v in failed.most_common())
    print(
        f"Map files: {len(todo)} due, {written} written, {n_failed} failed"
        + (f" ({why})" if why else "")
        + (f", {left} left for the next Refresh" if left else "")
    )
    if written:
        await asyncio.to_thread(db_writer.revalidate, env)
    return written


def main(argv=None):
    """The step on its own: Steam login, the catalogue, every due Map within `--budget`."""
    ap = argparse.ArgumentParser(description="Download every due Workshop Map's file.")
    ap.add_argument("--budget", type=float, default=3600.0, help="seconds (default 3600)")
    ap.add_argument("--dev", action="store_true", help="write DEV_DATABASE_URL only")
    args = ap.parse_args(argv)

    token, key = cc.load_refresh_token(), cc.load_key()
    if not (token and key):
        print("ERROR: needs STEAM_REFRESH_TOKEN and STEAM_API_KEY")
        return 2
    catalogue = cc.workshop_catalogue(key)
    client = steam.Client()
    result = {}

    @client.event
    async def on_ready():
        try:
            result["written"] = await record_map_files(
                catalogue, steam_download(client), scratch=args.dev, budget=args.budget
            )
        finally:
            await client.close()

    try:
        client.run(refresh_token=token)
    except Exception as e:
        # steam.py often raises on the teardown after close(); only a run that never got
        # to the step is a failure
        if "written" not in result:
            print(f"ERROR: Steam login/run failed: {e!r}")
            return 1
    return 0 if result.get("written") is not None else 1


if __name__ == "__main__":
    sys.exit(main())
