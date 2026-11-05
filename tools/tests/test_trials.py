"""The Trials the collector reads on every Refresh: the game's two Tower boards, read as a
Track is (GLOSSARY.md, Trial). Leth Trial #1 stays an Event board, read once (test_events)."""

import campaign_common as cc
import db_writer
import steampy_collect


def test_every_refresh_reads_both_towers_by_their_ids_as_trials():
    read = steampy_collect.circuit_boards()
    assert ("Map_TheTower", 17990402, "Trials") in read
    assert ("Map_TheTowerCP", 18587284, "Trials") in read


def test_the_trials_come_after_the_seasons():
    groups = [group for _, group in cc.BOARDS]
    assert groups[-2:] == ["Trials", "Trials"]
    assert groups.index("Trials") > groups.index("Season 2")


def test_the_towers_are_named_and_kept_apart():
    assert cc.display_name("Map_TheTower") == "The Tower"
    assert cc.display_name("Map_TheTowerCP") == "The Tower (Checkpoints)"


def test_a_tower_is_a_timed_board_not_points_and_not_numbered():
    assert db_writer.board_kind("Map_TheTower") == "track"
    assert db_writer.board_kind("Map_TheTowerCP") == "track"
    assert cc.track_number("Map_TheTowerCP") is None
    assert cc.track_tier("Map_TheTowerCP") is None
