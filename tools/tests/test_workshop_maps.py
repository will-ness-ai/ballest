"""workshop_maps.py's choices, without Steam: what a query names, and which Maps it finds."""

from workshop_maps import campaign_line, curated_ids, match, parse_query

MAPS = [
    {"pfid": "3", "title": "Hydro 3", "creator": "Action Jackson", "cid": "765", "created": 300},
    {"pfid": "1", "title": "Hydro 1", "creator": "Action Jackson", "cid": "765", "created": 100},
    {"pfid": "2", "title": "focus", "creator": "habibal223366977", "cid": "761", "created": 200},
    {"pfid": "4", "title": "One", "creator": "♬TEKKNO TRAIN♬", "cid": "762", "created": 400},
]


def test_a_query_is_a_collection_a_player_or_a_name():
    assert parse_query("https://steamcommunity.com/sharedfiles/filedetails/?id=3821607033") == (
        "collection",
        "3821607033",
    )
    assert parse_query("https://steamcommunity.com/profiles/76561199154600151/myworkshopfiles") == (
        "player",
        "76561199154600151",
    )
    assert parse_query("76561199154600151") == ("player", "76561199154600151")
    assert parse_query("3821607033") == ("collection", "3821607033")
    assert parse_query("tekkno") == ("name", "tekkno")


def test_a_player_or_a_name_finds_their_maps_oldest_first():
    assert [m["pfid"] for m in match(MAPS, ("player", "765"))] == ["1", "3"]
    # the in-game name, in any case, or a Workshop title
    assert [m["pfid"] for m in match(MAPS, ("name", "action jackson"))] == ["1", "3"]
    assert [m["pfid"] for m in match(MAPS, ("name", "tekkno"))] == ["4"]
    assert [m["pfid"] for m in match(MAPS, ("name", "Hydro"))] == ["1", "3"]


def test_a_collection_keeps_its_own_order():
    assert [m["pfid"] for m in match(MAPS, ("collection", "9"), children=["3", "2", "1"])] == [
        "3",
        "2",
        "1",
    ]


def test_the_campaign_line_is_ready_to_paste():
    assert campaign_line(MAPS[:2]) == 'maps: ["3", "1"],'


def test_curated_ids_reads_campaigns_ts():
    source = 'maps: ["3605138459", "3607096927"],\n  maps: [\n    "3612357898",\n  ],'
    assert curated_ids(source) == {"3605138459", "3607096927", "3612357898"}
