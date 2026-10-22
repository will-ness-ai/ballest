"""Which Event boards a Refresh reads: each one once, until a read succeeds."""

import campaign_common as cc


def test_every_event_board_is_due_until_one_read_succeeds():
    assert cc.events_due(set()) == [("Map_LethTrial_01", 20899741)]


def test_an_event_board_read_ok_is_never_due_again():
    assert cc.events_due({"Map_LethTrial_01"}) == []
