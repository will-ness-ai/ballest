"""The collector's database writer (db_writer.write_refresh), driven with Refreshes as the
collector holds them, and read back the way a reader of Score history would."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import daily
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


def test_an_overall_board_keeps_only_current_points_in_one_entry(conn):
    # Overall points move for most players every Refresh (docs/adr/0005), so a points
    # board keeps one Entry per player, updated in place; its history is rebuilt from
    # the tracks'.
    overall = "OverallLeaderboard_EASeason2"
    r1 = db_writer.write_refresh(conn, refresh(0, [board(overall, ("1001", 500), ("1002", 400))]))
    r2 = db_writer.write_refresh(conn, refresh(1, [board(overall, ("1001", 520))]))
    assert history(conn, overall, "1001") == [(520, r1, r2, None)]
    assert history(conn, overall, "1002") == [(400, r1, r1, r2)]


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


def test_a_board_whose_read_failed_is_a_failed_read_and_moves_nothing(conn):
    r1 = db_writer.write_refresh(
        conn, refresh(0, [board(TRACK, ("1001", 1013307), ("1002", 1100000))])
    )
    # any rows a failed board carries are ignored; here they even look different
    r2 = db_writer.write_refresh(
        conn, refresh(1, [board(TRACK, ("1001", 1000000))], failed=(TRACK,))
    )
    assert reads(conn, r2) == {TRACK: False}
    assert history(conn, TRACK, "1001") == [(1013307, r1, r1, None)]
    assert history(conn, TRACK, "1002") == [(1100000, r1, r1, None)]


def test_an_empty_board_is_rejected_like_a_failed_read(conn):
    r1 = db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307))]))
    r2 = db_writer.write_refresh(conn, refresh(1, [board(TRACK)]))
    assert reads(conn, r2) == {TRACK: False}
    assert history(conn, TRACK, "1001") == [(1013307, r1, r1, None)]


def test_overall_boards_score_points(conn):
    db_writer.write_refresh(
        conn,
        refresh(
            0,
            [
                board("OverallLeaderboard_EASeason2", ("1001", 40000)),
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


def ws(m, read=None, failed=(), *, full_sweep=False):
    return {
        "maps": [m],
        "boards": {PFID: read} if read is not None else {},
        "failed": list(failed),
        "full_sweep": full_sweep,
    }


def test_a_map_not_read_has_no_board_read_and_keeps_its_entries(conn):
    r1 = db_writer.write_refresh(
        conn, refresh(0, [], workshop=ws(a_map(), rows(("1001", 2931805), ("1002", 3073137))))
    )
    r2 = db_writer.write_refresh(conn, refresh(1, [], workshop=ws(a_map())))
    assert reads(conn, r2) == {}
    assert history(conn, MAP, "1002") == [(3073137, r1, r1, None)]
    # a Workshop step that failed or declined reads no Map at all
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


# The collector's memory (db_writer.load_memory): what the next run reads back.


def test_memory_holds_each_maps_handle_and_counters_as_of_its_last_good_read(conn):
    db_writer.write_refresh(
        conn, refresh(0, [], workshop=ws(a_map(), rows(("1001", 2931805), ("1002", 3073137))))
    )
    # the next run's read failed, so it kept the counters it had
    db_writer.write_refresh(conn, refresh(1, [], workshop=ws(a_map(), failed=[PFID])))
    memory = db_writer.read_memory(conn)
    assert memory.maps == {
        PFID: {"handle": "21195816", "entry_count": 2, "rows": 2, "sessions": 6, "subs": 10}
    }
    assert memory.listed == 1


def test_memory_has_no_handle_for_a_map_with_no_board_yet(conn):
    db_writer.write_refresh(
        conn, refresh(0, [], workshop=ws(a_map(handle=None, entry_count=0, sessions=None)))
    )
    assert db_writer.read_memory(conn).maps[PFID] == {
        "handle": None,
        "entry_count": 0,
        "rows": 0,
        "sessions": None,
        "subs": 10,
    }


def test_memory_lists_only_the_maps_the_latest_catalogue_carried(conn):
    gone = a_map(name="Workshop_1", pfid="1", handle="5")
    db_writer.write_refresh(conn, refresh(0, [], workshop={**ws(a_map()), "maps": [a_map(), gone]}))
    db_writer.write_refresh(conn, refresh(1, [], workshop=ws(a_map())))
    memory = db_writer.read_memory(conn)
    assert set(memory.maps) == {PFID, "1"}
    assert memory.listed == 1


def test_memory_knows_the_latest_full_sweep(conn):
    assert db_writer.read_memory(conn).full_sweep_at == 0
    db_writer.write_refresh(conn, refresh(0, [], workshop=ws(a_map(), full_sweep=True)))
    db_writer.write_refresh(conn, refresh(1, [], workshop=ws(a_map())))
    assert db_writer.read_memory(conn).full_sweep_at == int(T0.timestamp())


def test_memory_carries_every_named_players_profile(conn):
    db_writer.write_refresh(
        conn, refresh(0, [board(TRACK, ("1001", 1013307), ("1002", 1100000), names={"1002": ""})])
    )
    assert db_writer.read_memory(conn).names == {
        "1001": {"persona": "p001", "avatar": "", "profileurl": ""}
    }


# Dailies (tools/daily.py): each its own board, read until a read after its close.

DAY = daily.Daily(
    date="2026-10-06",
    board="ballest_v0_3812794783_Daily_20261006_0a1b2c3d",
    leaderboard_id="20900006",
    pfid=PFID,
    title="Jungle islands",
    starts_at=datetime(2026, 10, 6, 1, tzinfo=UTC),
    ends_at=datetime(2026, 10, 7, 1, tzinfo=UTC),
)


def daily_read(read_at, *pairs, failed=False, of=DAY):
    return daily.DailyRead(daily=of, rows=None if failed else rows(*pairs), read_at=read_at)


def dailies(conn):
    return conn.execute(
        "select date::text, board, pfid, title, starts_at, ends_at, final_refresh from dailies"
        " order by date"
    ).fetchall()


def test_a_refresh_carrying_a_daily_writes_its_board_daily_read_and_entries(conn):
    live = DAY.starts_at + timedelta(hours=5)
    r1 = db_writer.write_refresh(
        conn, refresh(0, [], dailies=[daily_read(live, ("1001", 2931805), ("1002", 3073137))])
    )
    assert conn.execute(
        "select kind, display, leaderboard_id, scores_points from boards where name = %s",
        (DAY.board,),
    ).fetchone() == ("daily", "Jungle islands", 20900006, False)
    assert dailies(conn) == [
        ("2026-10-06", DAY.board, PFID, "Jungle islands", DAY.starts_at, DAY.ends_at, None)
    ]
    assert reads(conn, r1) == {DAY.board: True}
    assert history(conn, DAY.board, "1002") == [(3073137, r1, r1, None)]


def final_refresh(conn):
    (rid,) = conn.execute(
        "select final_refresh from dailies where date = %s", (DAY.date,)
    ).fetchone()
    return rid


def test_only_a_read_at_or_after_the_close_makes_a_daily_final(conn):
    just_before = DAY.ends_at - timedelta(minutes=1)
    db_writer.write_refresh(
        conn, refresh(0, [], dailies=[daily_read(just_before, ("1001", 2931805))])
    )
    assert final_refresh(conn) is None
    r2 = db_writer.write_refresh(
        conn, refresh(1, [], dailies=[daily_read(DAY.ends_at, ("1001", 2931805))])
    )
    assert final_refresh(conn) == r2
    # a later read, had one been made, never moves it
    later = DAY.ends_at + timedelta(hours=3)
    db_writer.write_refresh(conn, refresh(2, [], dailies=[daily_read(later, ("1001", 2931805))]))
    assert final_refresh(conn) == r2


def test_a_failed_or_empty_daily_read_moves_nothing_and_never_makes_it_final(conn):
    live = DAY.starts_at + timedelta(hours=5)
    r1 = db_writer.write_refresh(
        conn, refresh(0, [], dailies=[daily_read(live, ("1001", 2931805), ("1002", 3073137))])
    )
    r2 = db_writer.write_refresh(
        conn, refresh(1, [], dailies=[daily_read(DAY.ends_at, failed=True)])
    )
    r3 = db_writer.write_refresh(conn, refresh(2, [], dailies=[daily_read(DAY.ends_at)]))
    assert reads(conn, r2) == {DAY.board: False}
    assert reads(conn, r3) == {DAY.board: False}
    assert open_entries(conn, DAY.board) == {"1001": 2931805, "1002": 3073137}
    assert history(conn, DAY.board, "1001") == [(2931805, r1, r1, None)]
    assert final_refresh(conn) is None


def test_a_daily_read_just_after_it_opens_with_no_times_yet_is_still_written(conn):
    # a read just after the Daily opens finds a board nobody has finished yet: the site
    # still gets the Daily's page, with no times
    r1 = db_writer.write_refresh(
        conn, refresh(0, [], dailies=[daily_read(DAY.starts_at + timedelta(minutes=5))])
    )
    assert dailies(conn) == [
        ("2026-10-06", DAY.board, PFID, "Jungle islands", DAY.starts_at, DAY.ends_at, None)
    ]
    assert reads(conn, r1) == {DAY.board: False}
    assert open_entries(conn, DAY.board) == {}


def test_a_better_daily_time_closes_the_old_entry_and_opens_a_new_one(conn):
    live = DAY.starts_at + timedelta(hours=5)
    r1 = db_writer.write_refresh(
        conn, refresh(0, [], dailies=[daily_read(live, ("1001", 2931805))])
    )
    r2 = db_writer.write_refresh(
        conn, refresh(1, [], dailies=[daily_read(live + timedelta(hours=3), ("1001", 2800000))])
    )
    assert history(conn, DAY.board, "1001") == [(2931805, r1, r1, r2), (2800000, r2, r2, None)]


def test_the_dailies_written_are_the_ones_the_next_run_knows(conn):
    other = daily.Daily(
        date="2026-10-07",
        board="ballest_v0_1_Daily_20261007_0",
        leaderboard_id="20900007",
        pfid="1",
        title="Next",
        starts_at=DAY.ends_at,
        ends_at=DAY.ends_at + timedelta(days=1),
    )
    live = other.starts_at + timedelta(hours=1)
    db_writer.write_refresh(
        conn,
        refresh(
            0,
            [],
            dailies=[daily_read(live, ("1001", 2931805)), daily_read(live, ("1001", 1), of=other)],
        ),
    )
    known = db_writer.known_dailies(conn)
    assert known == {DAY.date: replace(DAY, final=True), other.date: other}


def test_a_daily_leaves_the_maps_and_tracks_read_beside_it_alone(conn):
    live = DAY.starts_at + timedelta(hours=5)
    r1 = db_writer.write_refresh(
        conn,
        refresh(
            0,
            [board(TRACK, ("1001", 1013307))],
            workshop=ws(a_map(), rows(("1001", 3100000), ("1002", 3073137))),
            dailies=[daily_read(live, ("1001", 2931805))],
        ),
    )
    # the Daily is played on the Map, but its board and times are its own
    assert open_entries(conn, MAP) == {"1001": 3100000, "1002": 3073137}
    assert open_entries(conn, DAY.board) == {"1001": 2931805}
    r2 = db_writer.write_refresh(
        conn,
        refresh(
            1,
            [board(TRACK, ("1001", 1013307))],
            workshop=ws(a_map()),
            dailies=[daily_read(DAY.ends_at, ("1003", 2700000))],
        ),
    )
    assert reads(conn, r2) == {TRACK: True, DAY.board: True}
    assert history(conn, MAP, "1001") == [(3100000, r1, r1, None)]
    assert history(conn, TRACK, "1001") == [(1013307, r1, r2, None)]
    assert open_entries(conn, DAY.board) == {"1003": 2700000}


def test_memory_counts_the_refreshes_written(conn):
    assert db_writer.read_memory(conn).refreshes == 0
    db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307))]))
    db_writer.write_refresh(conn, refresh(1, [board(TRACK, ("1001", 1013307))]))
    assert db_writer.read_memory(conn).refreshes == 2


def test_memory_knows_who_set_a_score_in_the_latest_refresh(conn):
    assert db_writer.read_memory(conn).just_scored == set()
    db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307), ("1002", 1100000))]))
    # 1002 improves; 1001 stands still, and 1003 is new
    db_writer.write_refresh(
        conn, refresh(1, [board(TRACK, ("1001", 1013307), ("1002", 1090000), ("1003", 1200000))])
    )
    assert db_writer.read_memory(conn).just_scored == {"1002", "1003"}


# Daily reads (CONTEXT.md): the open Dailies only, every 15 minutes between Refreshes.


def daily_only(n, *reads):
    return db_writer.Refresh(
        started_at=T0 + timedelta(hours=3 * n, minutes=15), dailies=reads, source="daily"
    )


def test_a_daily_read_writes_its_daily_marked_as_a_daily_read(conn):
    live = DAY.starts_at + timedelta(hours=5)
    rid = db_writer.write_refresh(conn, daily_only(0, daily_read(live, ("1001", 2931805))))
    assert conn.execute("select source::text from refreshes where id = %s", (rid,)).fetchone() == (
        "daily",
    )
    assert [d[0] for d in dailies(conn)] == [DAY.date]
    assert open_entries(conn, DAY.board) == {"1001": 2931805}


def test_memory_counts_only_refreshes_not_daily_reads(conn):
    db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307))]))
    live = DAY.starts_at + timedelta(hours=5)
    db_writer.write_refresh(conn, daily_only(0, daily_read(live, ("1001", 2931805))))
    db_writer.write_refresh(conn, daily_only(0, daily_read(live, ("1002", 2931806))))
    assert db_writer.read_memory(conn).refreshes == 1


def test_who_set_a_score_in_the_latest_refresh_skips_the_daily_reads_after_it(conn):
    db_writer.write_refresh(conn, refresh(0, [board(TRACK, ("1001", 1013307))]))
    live = DAY.starts_at + timedelta(hours=5)
    db_writer.write_refresh(conn, daily_only(0, daily_read(live, ("1002", 2931805))))
    assert db_writer.read_memory(conn).just_scored == {"1001"}


def test_memory_holds_each_open_dailys_board_and_none_once_it_is_final(conn):
    live = DAY.starts_at + timedelta(hours=5)
    db_writer.write_refresh(
        conn, daily_only(0, daily_read(live, ("1001", 2931805), ("1002", 2931900)))
    )
    db_writer.write_refresh(conn, daily_only(0, daily_read(live, ("1001", 2931700))))
    assert db_writer.read_memory(conn).daily_boards == {DAY.date: frozenset({("1001", 2931700)})}
    db_writer.write_refresh(conn, daily_only(1, daily_read(DAY.ends_at, ("1001", 2931700))))
    assert db_writer.read_memory(conn).daily_boards == {}
