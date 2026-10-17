"""Which players' names a run looks up (campaign_common.names_due): every player without one,
everyone who just scored, and a rotating slice of the rest, so every name is looked up again
in time."""

import campaign_common as cc
from db_writer import Memory

KNOWN = {str(76561199080598100 + i): {"persona": f"p{i}"} for i in range(200)}


def due(refreshes, just_scored=(), ids=KNOWN):
    return cc.names_due(ids, Memory(names=KNOWN, refreshes=refreshes, just_scored=set(just_scored)))


def test_a_player_without_a_name_is_looked_up_every_run():
    assert "1001" in due(7, ids=["1001"])


def test_every_known_name_is_looked_up_within_one_turn_of_the_slices():
    # Counted in Refreshes, not hours: GitHub starts the scheduled run late or not at all,
    # and a slice keyed on the clock was skipped for weeks (NachoCS's rename, 2026-10).
    looked_up = set()
    for n in range(1000, 1000 + cc.NAME_REFRESH_SLICES):
        looked_up |= set(due(n))
    assert looked_up == set(KNOWN)


def test_a_run_looks_up_only_its_own_slice_of_the_known_names():
    assert 0 < len(due(3)) <= len(KNOWN) // cc.NAME_REFRESH_SLICES + 1


def test_a_player_who_just_set_a_score_is_looked_up_whatever_the_slice():
    sid = next(s for s in KNOWN if s not in due(3))
    assert sid in due(3, just_scored={sid})
