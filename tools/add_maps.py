"""
Add the Workshop's newest Maps to the database between Refreshes: the step a post in the
game Discord's #new-tracks starts (Multiballs asks the collector's service, runner.py, which
runs `add_new` on POST /add-maps).

Reads the newest page of the Workshop catalogue (one Steam Web API request, no Steam login)
and writes each Map the database lacks with db_writer.add_maps, so its page appears within
minutes instead of at the next Refresh, with an empty board until it has times. Its board
and Ghosts wait for that Refresh. Steam's list can lag the post, so while nothing is new it
reads it again, TRIES reads in all, RETRY_SECONDS apart. Then it revalidates the site and
returns the Maps it added, for the service to download their files (map_files.download_due).

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
import psycopg

TRIES = 5
RETRY_SECONDS = 60


def add_when_listed(newest, add, sleep):
    """The pfids add wrote from newest's Maps, trying TRIES times while nothing is new. A
    failed read of Steam counts as a try; a failed write raises."""
    for attempt in range(1, TRIES + 1):
        try:
            catalogue = newest()
        except Exception as e:
            print(f"  [warn] reading the Workshop's newest Maps failed: {e!r}")
        else:
            added = add(catalogue)
            if added:
                return added
            print(f"  nothing new on try {attempt} of {TRIES}")
        if attempt < TRIES:
            sleep(RETRY_SECONDS)
    return []


def add_new(*, dev=False, env=None, sleep=time.sleep):
    """The step: the pfids of the newest Maps it added to DATABASE_URL (with `dev`, only
    DEV_DATABASE_URL), [] when Steam listed none new. Blocking, so the service runs it in a
    thread. Raises when there is no database or the write fails."""
    env = os.environ if env is None else env
    url = db_writer.database_url(env, scratch=dev)
    if not url:
        raise RuntimeError(f"No {'DEV_DATABASE_URL' if dev else 'DATABASE_URL'} to write to")
    key = cc.load_key()
    with psycopg.connect(url, autocommit=True, connect_timeout=30) as conn:
        added = add_when_listed(
            lambda: cc.newest_maps(key), lambda c: db_writer.add_maps(conn, c), sleep
        )
    if not added:
        print("No new Workshop Map to add; the next Refresh lists any Steam was slow to show")
        return []
    print(f"Added {len(added)} Workshop Map(s): {', '.join(added)}")
    db_writer.revalidate(env)
    return added


if __name__ == "__main__":
    add_new(dev="--dev" in sys.argv[1:])
