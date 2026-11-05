"""db_backfill.prepare: which databases a replay of data/'s git history may write."""

from datetime import UTC, datetime

import db_backfill

LAST = datetime(2026, 10, 11, tzinfo=UTC)  # the newest snapshot in git


def refresh(conn, source, when):
    conn.execute("insert into refreshes (started_at, source) values (%s, %s)", (when, source))


def test_an_empty_database_is_replayed_into(conn):
    assert db_backfill.prepare(conn, rebuild=False, last=LAST)


def test_a_database_with_refreshes_needs_rebuild(conn):
    refresh(conn, "collector", datetime(2026, 10, 1, tzinfo=UTC))
    assert not db_backfill.prepare(conn, rebuild=False, last=LAST)
    assert db_backfill.prepare(conn, rebuild=True, last=LAST)
    assert conn.execute("select count(*) from refreshes").fetchone() == (0,)


def test_a_collector_refresh_git_has_no_copy_of_is_never_truncated(conn, capsys):
    refresh(conn, "collector", datetime(2026, 10, 12, tzinfo=UTC))
    assert not db_backfill.prepare(conn, rebuild=True, last=LAST)
    assert conn.execute("select count(*) from refreshes").fetchone() == (1,)
    assert "cannot bring back" in capsys.readouterr().out


class FakeBlobs:
    """Each blob a board file whose one row is named after its sha."""

    def read(self, sha):
        return {"handle": 1, "entry_count": 1, "rows": [{"steam_id": "1", "name": sha}]}


def test_a_snapshot_leaves_the_trials_unread():
    """data/ kept Map_TheTower only in its first snapshots (to b12205f3): replaying them
    would leave those Entries open, so a Trial's file is never read as its board."""
    files = {
        "data/boards/Map_Track13.json": "t13",
        "data/boards/Map_TheTower.json": "tower",
    }
    boards, workshop = db_backfill.snapshot(files, {}, FakeBlobs(), {})
    assert [b["name"] for b in boards] == ["Map_Track13"]
    assert workshop is None
