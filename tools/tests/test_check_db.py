"""check_db, the dual-write parity check: the database's open Entries against board files."""

from datetime import UTC, datetime, timedelta

import check_db
import db_writer
from test_db_writer import DAY, MAP, PFID, TRACK, a_map, board, daily_read, rows, ws


def written(conn):
    db_writer.write_refresh(
        conn,
        db_writer.Refresh(
            started_at=datetime(2026, 10, 1, tzinfo=UTC),
            boards=[board(TRACK, ("1001", 1013307), ("1002", 1100000))],
            workshop=ws(a_map(), rows(("1001", 2931805))),
        ),
    )
    return check_db.db_boards(conn)


def test_matching_files_are_no_drift(conn):
    want = {TRACK: {"1001": 1013307, "1002": 1100000}, MAP: {"1001": 2931805}}
    assert check_db.compare(want, written(conn), {PFID}) == []


def test_a_differing_score_a_missing_player_and_an_unknown_board_are_drift(conn):
    want = {TRACK: {"1001": 1013000, "1003": 1200000}, "Map_Track15": {"1001": 1800000}}
    problems = check_db.compare(want, written(conn), {PFID})
    assert len(problems) == 3
    assert problems[0].startswith(f"{TRACK}: file has 2, database 2 open")
    assert "missing 1 (1003)" in problems[0]
    assert "score differs 1 (1001)" in problems[0]
    assert problems[1].startswith("Map_Track15: has a board file but is not in the database")
    # the Map is still listed but has no file: its open Entries are drift
    assert problems[2].startswith(f"{MAP}: 1 open Entries in the database but no board file")


def test_a_daily_has_no_file_to_compare_and_is_not_drift(conn):
    live = DAY.starts_at + timedelta(hours=1)
    db_writer.write_refresh(
        conn,
        db_writer.Refresh(
            started_at=live,
            dailies=(daily_read(live, ("1001", 2931805)),),
        ),
    )
    want = {TRACK: {"1001": 1013307, "1002": 1100000}, MAP: {"1001": 2931805}}
    assert check_db.compare(want, written(conn), {PFID}) == []


def test_a_map_gone_from_the_workshop_is_not_drift(conn):
    want = {TRACK: {"1001": 1013307, "1002": 1100000}}
    assert check_db.compare(want, written(conn), set()) == []
