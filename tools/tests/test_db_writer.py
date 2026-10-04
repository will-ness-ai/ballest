"""The collector's database writer (db_writer.write_refresh), driven with Refreshes as the
collector holds them, and read back the way a reader of Score history would."""

from datetime import UTC, datetime, timedelta

import db_writer
import psycopg
import pytest

T0 = datetime(2026, 10, 1, tzinfo=UTC)
TRACK = "Map_Track13"  # Season 1's track 01


def rows(*pairs, names=None):
    """Board rows as board_rows + name_rows leave them, rank-ordered by the caller."""
    names = names or {}
    return [
        {
            "rank": i + 1,
            "steam_id": sid,
            "score_ms": score,
            "time": "",
            "ugc_id": "9" + sid[-3:],
            "persona": names.get(sid, "p" + sid[-3:]),
            "avatar": "",
            "profileurl": "",
        }
        for i, (sid, score) in enumerate(pairs)
    ]


def board(name, *pairs, names=None):
    return {
        "name": name,
        "group": "Season 1",
        "entry_count": len(pairs),
        "rows": rows(*pairs, names=names),
    }


def refresh(n, boards, **kw):
    return db_writer.Refresh(started_at=T0 + timedelta(hours=3 * n), boards=boards, **kw)


def open_entries(conn, name):
    return dict(
        conn.execute(
            "select steam_id, score from entries where board = %s and closed_refresh is null",
            (name,),
        ).fetchall()
    )


def history(conn, name, sid):
    """(score, first seen, last seen, closed) for every Entry a player has held, oldest first."""
    return conn.execute(
        "select score, first_seen_refresh, last_seen_refresh, closed_refresh from entries"
        " where board = %s and steam_id = %s order by id",
        (name, sid),
    ).fetchall()


def test_a_first_refresh_opens_an_entry_per_row(conn):
    r1 = db_writer.write_refresh(
        conn, refresh(0, [board(TRACK, ("1001", 1013307), ("1002", 1019884))])
    )
    assert open_entries(conn, TRACK) == {"1001": 1013307, "1002": 1019884}
    assert history(conn, TRACK, "1001") == [(1013307, r1, r1, None)]


def test_an_unchanged_score_keeps_its_entry_and_moves_last_seen(conn):
    r1 = db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307))]))
    r2 = db_writer.write_refresh(conn, refresh(1, [board(TRACK, ("1001", 1013307))]))
    assert history(conn, TRACK, "1001") == [(1013307, r1, r2, None)]


def test_an_improvement_closes_the_old_entry_and_opens_a_new_one(conn):
    r1 = db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307))]))
    r2 = db_writer.write_refresh(conn, refresh(1, [board(TRACK, ("1001", 1009000))]))
    assert history(conn, TRACK, "1001") == [(1013307, r1, r1, r2), (1009000, r2, r2, None)]
    assert open_entries(conn, TRACK) == {"1001": 1009000}


def test_a_new_player_opens_an_entry_beside_the_others(conn):
    r1 = db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307))]))
    r2 = db_writer.write_refresh(
        conn, refresh(1, [board(TRACK, ("1001", 1013307), ("1002", 1100000))])
    )
    assert history(conn, TRACK, "1002") == [(1100000, r2, r2, None)]
    assert history(conn, TRACK, "1001") == [(1013307, r1, r2, None)]


def test_a_player_gone_from_the_board_is_closed_not_deleted(conn):
    r1 = db_writer.write_refresh(
        conn, refresh(0, [board(TRACK, ("1001", 1013307), ("1002", 1100000))])
    )
    r2 = db_writer.write_refresh(conn, refresh(1, [board(TRACK, ("1001", 1013307))]))
    assert history(conn, TRACK, "1002") == [(1100000, r1, r1, r2)]
    assert open_entries(conn, TRACK) == {"1001": 1013307}


def reads(conn, rid):
    return dict(
        conn.execute("select board, ok from board_reads where refresh_id = %s", (rid,)).fetchall()
    )


def test_a_board_kept_from_the_committed_copy_is_a_failed_read_and_moves_nothing(conn):
    r1 = db_writer.write_refresh(
        conn, refresh(0, [board(TRACK, ("1001", 1013307), ("1002", 1100000))])
    )
    # the collector reuses the committed rows; here they even look different
    r2 = db_writer.write_refresh(
        conn, refresh(1, [board(TRACK, ("1001", 1000000))], reused=(TRACK,))
    )
    assert reads(conn, r2) == {TRACK: False}
    assert history(conn, TRACK, "1001") == [(1013307, r1, r1, None)]
    assert history(conn, TRACK, "1002") == [(1100000, r1, r1, None)]


def test_an_empty_board_is_rejected_like_a_failed_read(conn):
    r1 = db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307))]))
    r2 = db_writer.write_refresh(conn, refresh(1, [board(TRACK)]))
    assert reads(conn, r2) == {TRACK: False}
    assert history(conn, TRACK, "1001") == [(1013307, r1, r1, None)]


def test_derived_boards_are_not_stored_and_overall_boards_score_points(conn):
    db_writer.write_refresh(
        conn,
        refresh(
            0,
            [
                board("OverallLeaderboard_EASeason2", ("1001", 40000)),
                board("OverallLeaderboard_S1Current", ("1001", 80000)),
                board("OverallLeaderboard_AllSeasons", ("1001", 120000)),
                board(TRACK, ("1001", 1013307)),
            ],
        ),
    )
    stored = conn.execute("select name, kind, scores_points from boards order by name").fetchall()
    assert stored == [(TRACK, "track", False), ("OverallLeaderboard_EASeason2", "overall", True)]
    assert open_entries(conn, "OverallLeaderboard_EASeason2") == {"1001": 40000}


def test_a_persona_change_appends_history_and_an_unchanged_one_moves_last_seen(conn):
    def named(n, persona):
        return refresh(n, [board(TRACK, ("1001", 1013307), names={"1001": persona})])

    r1 = db_writer.write_refresh(conn, named(0, "Hky"))
    r2 = db_writer.write_refresh(conn, named(1, "Hky"))
    r3 = db_writer.write_refresh(conn, named(2, "Hky."))
    db_writer.write_refresh(conn, named(3, ""))  # a failed name lookup changes nothing
    assert conn.execute(
        "select persona, first_seen_refresh, last_seen_refresh from persona_history"
        " where steam_id = '1001' order by id"
    ).fetchall() == [("Hky", r1, r2), ("Hky.", r3, r3)]
    assert conn.execute("select persona from players where steam_id = '1001'").fetchone() == (
        "Hky.",
    )


def test_an_error_inside_the_transaction_rolls_back_the_whole_refresh(conn):
    r1 = db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307))]))
    # a second board claiming the first one's leaderboard ID: the database refuses it,
    # after this Refresh has already moved TRACK's Entries inside the transaction
    clash = board("Map_Track99", ("1001", 1800000))
    clash["handle"] = str(db_writer.cc.LEADERBOARD_IDS[TRACK])
    with pytest.raises(psycopg.errors.UniqueViolation):
        db_writer.write_refresh(conn, refresh(1, [board(TRACK, ("1001", 1009000)), clash]))
    assert conn.execute("select id from refreshes").fetchall() == [(r1,)]
    assert history(conn, TRACK, "1001") == [(1013307, r1, r1, None)]
    assert open_entries(conn, "Map_Track99") == {}
    # and the connection is usable for the next Refresh
    r3 = db_writer.write_refresh(conn, refresh(2, [board(TRACK, ("1001", 1009000))]))
    assert open_entries(conn, TRACK) == {"1001": 1009000}
    assert r3 > r1


def test_a_written_refresh_is_committed_for_every_other_reader(conn, db_url):
    db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307))]))
    conn.execute("select 1")  # a reader on the writer's connection, as the backfill is
    db_writer.write_refresh(conn, refresh(1, [board(TRACK, ("1001", 1009000))]))
    with psycopg.connect(db_url) as other:
        assert open_entries(other, TRACK) == {"1001": 1009000}


def test_a_connection_inside_a_transaction_is_refused(db_url):
    with psycopg.connect(db_url) as c:
        c.execute("select 1")  # psycopg has opened a transaction the writer can't commit
        with pytest.raises(RuntimeError, match="outside a transaction"):
            db_writer.write_refresh(c, refresh(0, [board(TRACK, ("1001", 1013307))]))


PFID = "3812794783"
MAP = "Workshop_" + PFID


def a_map(**kw):
    return {
        "name": MAP,
        "pfid": PFID,
        "display": "Jungle islands",
        "creator": "BULLTIS",
        "cid": "76561199225434643",
        "preview": "https://example.invalid/p.jpg",
        "created": 1791052606,
        "medals": [71.0, 53.0, 47.0, 43.8],
        "handle": "21195816",
        "entry_count": 2,
        "sessions": 6,
        "subs": 10,
    } | kw


def ws(m, read=None, failed=()):
    return {
        "maps": [m],
        "boards": {PFID: read} if read is not None else {},
        "failed": list(failed),
    }


def test_a_map_not_read_has_no_board_read_and_keeps_its_entries(conn):
    r1 = db_writer.write_refresh(
        conn, refresh(0, [], workshop=ws(a_map(), rows(("1001", 2931805), ("1002", 3073137))))
    )
    r2 = db_writer.write_refresh(conn, refresh(1, [], workshop=ws(a_map())))
    assert reads(conn, r2) == {}
    assert history(conn, MAP, "1002") == [(3073137, r1, r1, None)]
    # a Workshop step that published nothing reads no Map at all
    r3 = db_writer.write_refresh(conn, refresh(2, [board(TRACK, ("1001", 1013307))]))
    assert reads(conn, r3) == {TRACK: True}
    assert open_entries(conn, MAP) == {"1001": 2931805, "1002": 3073137}


def test_a_failed_map_read_is_recorded_and_moves_nothing(conn):
    r1 = db_writer.write_refresh(
        conn, refresh(0, [], workshop=ws(a_map(), rows(("1001", 2931805))))
    )
    r2 = db_writer.write_refresh(conn, refresh(1, [], workshop=ws(a_map(), failed=[PFID])))
    assert reads(conn, r2) == {MAP: False}
    assert history(conn, MAP, "1001") == [(2931805, r1, r1, None)]


def test_a_map_read_moves_its_entries(conn):
    r1 = db_writer.write_refresh(
        conn, refresh(0, [], workshop=ws(a_map(), rows(("1001", 2931805), ("1002", 3073137))))
    )
    r2 = db_writer.write_refresh(
        conn, refresh(1, [], workshop=ws(a_map(), rows(("1002", 2900000), ("1001", 2931805))))
    )
    assert reads(conn, r2) == {MAP: True}
    assert history(conn, MAP, "1001") == [(2931805, r1, r2, None)]
    assert history(conn, MAP, "1002") == [(3073137, r1, r1, r2), (2900000, r2, r2, None)]
    assert conn.execute("select kind, display from boards where name = %s", (MAP,)).fetchone() == (
        "map",
        "Jungle islands",
    )


def test_map_history_appends_only_on_change(conn):
    r1 = db_writer.write_refresh(conn, refresh(0, [], workshop=ws(a_map())))
    r2 = db_writer.write_refresh(conn, refresh(1, [], workshop=ws(a_map())))
    r3 = db_writer.write_refresh(conn, refresh(2, [], workshop=ws(a_map(sessions=9, subs=12))))
    r4 = db_writer.write_refresh(
        conn, refresh(3, [], workshop=ws(a_map(sessions=9, subs=12, display="Jungle isles")))
    )
    assert conn.execute(
        "select title, sessions, first_seen_refresh, last_seen_refresh from map_history"
        " where pfid = %s order by id",
        (PFID,),
    ).fetchall() == [
        ("Jungle islands", 6, r1, r2),
        ("Jungle islands", 9, r3, r3),
        ("Jungle isles", 9, r4, r4),
    ]
