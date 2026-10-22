"""The Event step: which Event boards a Refresh reads (each one until a read succeeds), and
what a read hands the database writer, ok or not."""

import asyncio

import campaign_common as cc

LETH = "Map_LethTrial_01"


def test_every_event_board_is_due_until_one_read_succeeds():
    assert cc.events_due(set()) == [(LETH, 20899741)]


def test_an_event_board_read_ok_is_never_due_again():
    assert cc.events_due({LETH}) == []


def run(fetch, read_ok=frozenset()):
    return asyncio.run(cc.read_events(fetch, read_ok))


def test_a_good_read_is_a_board_with_its_rows_and_steams_count():
    rows = [{"steam_id": "1001", "score_ms": 2373600}]

    async def fetch(lid):
        assert lid == 20899741
        return 1628, rows

    assert run(fetch) == (
        [{"name": LETH, "group": None, "handle": "20899741", "entry_count": 1628, "rows": rows}],
        [],
    )


def test_a_read_that_raises_is_a_failed_board_and_never_escapes():
    async def fetch(_lid):
        raise TimeoutError

    assert run(fetch) == ([{"name": LETH, "group": None, "handle": "20899741", "rows": []}], [LETH])


def test_a_board_read_ok_before_is_not_read():
    async def fetch(_lid):
        raise AssertionError("read again")

    assert run(fetch, {LETH}) == ([], [])


def test_the_circuit_read_keeps_each_boards_group_and_goes_on_past_a_failure():
    async def fetch(lid):
        if lid == 2:
            raise ConnectionError
        return 1, [{"steam_id": "1001", "score_ms": 1013307}]

    out, failed = asyncio.run(
        cc.read_boards(fetch, [("Map_Track13", 1, "Season 1"), ("Map_Track15", 2, "Season 1")])
    )
    assert [(b["name"], b["group"], len(b["rows"])) for b in out] == [
        ("Map_Track13", "Season 1", 1),
        ("Map_Track15", "Season 1", 0),
    ]
    assert failed == ["Map_Track15"]
