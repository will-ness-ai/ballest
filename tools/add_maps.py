"""
Add the Workshop's newest Maps to the database between Refreshes: the step a post in the
game Discord's #new-tracks starts (Multiballs dispatches .github/workflows/add-maps.yml).

Reads the newest page of the Workshop catalogue (one Steam Web API request, no Steam login)
and writes each Map the database lacks with db_writer.add_maps, so its page appears within
minutes instead of at the next Refresh, with an empty board until it has times. Its board
and Ghosts wait for that Refresh. Steam's list can lag the post, so while nothing is new it
reads it again, TRIES reads in all, RETRY_SECONDS apart. Then it revalidates the site, and
with a Steam login downloads the new Maps' files for the 3D view (map_files.download), which
the next Refresh does instead when this fails or has no login.

It writes DATABASE_URL, or with --dev only DEV_DATABASE_URL (db_writer.database_url):
  DEV_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ballest_dev \\
    python tools/add_maps.py --dev
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc
import db_writer
import map_files
import psycopg

TRIES = 5
RETRY_SECONDS = 60
# the most the Map file step may spend on the new Maps' files
FILE_BUDGET = 120.0


def add_when_listed(newest, add, sleep):
    """The catalogue Maps add wrote (it returns their pfids) from newest's, trying TRIES
    times while nothing is new. A failed read of Steam counts as a try; a failed write
    raises."""
    for attempt in range(1, TRIES + 1):
        try:
            catalogue = newest()
        except Exception as e:
            print(f"  [warn] reading the Workshop's newest Maps failed: {e!r}")
        else:
            added = set(add(catalogue))
            if added:
                return [c for c in catalogue if c["pfid"] in added]
            print(f"  nothing new on try {attempt} of {TRIES}")
        if attempt < TRIES:
            sleep(RETRY_SECONDS)
    return []


def download_files(maps, *, scratch):
    """The Map file step on the Maps just added, when there is a Steam login to run it."""
    token = cc.load_refresh_token()
    if not token:
        print("No STEAM_REFRESH_TOKEN: the new Maps' files wait for the next Refresh")
        return
    map_files.download(maps, token, scratch=scratch, budget=FILE_BUDGET)


def main():
    dev = "--dev" in sys.argv[1:]
    url = db_writer.database_url(os.environ, scratch=dev)
    if not url:
        print(f"::error::No {'DEV_DATABASE_URL' if dev else 'DATABASE_URL'} to write to")
        return 1
    key = cc.load_key()
    with psycopg.connect(url, autocommit=True, connect_timeout=30) as conn:
        added = add_when_listed(
            lambda: cc.newest_maps(key), lambda c: db_writer.add_maps(conn, c), time.sleep
        )
    if not added:
        print("No new Workshop Map to add; the next Refresh lists any Steam was slow to show")
        return 0
    print(f"Added {len(added)} Workshop Map(s): {', '.join(c['pfid'] for c in added)}")
    db_writer.revalidate(os.environ)
    download_files(added, scratch=dev)
    return 0


if __name__ == "__main__":
    sys.exit(main())
