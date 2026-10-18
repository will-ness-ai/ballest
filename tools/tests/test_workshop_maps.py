"""workshop_maps.py's choices, without Steam: what a query names, and which Maps it finds."""

from workshop_maps import campaign_line, curated_ids, listed_on_site, match, parse_query, report

MAPS = [
    {"pfid": "3", "title": "Hydro 3", "creator": "Action Jackson", "cid": "765", "created": 300},
    {"pfid": "1", "title": "Hydro 1", "creator": "Action Jackson", "cid": "765", "created": 100},
    {"pfid": "2", "title": "focus", "creator": "habibal223366977", "cid": "761", "created": 200},
    {"pfid": "4", "title": "Jackson's", "creator": "♬TEKKNO TRAIN♬", "cid": "762", "created": 400},
]


def test_a_query_is_items_a_player_or_a_name():
    link = "https://steamcommunity.com/sharedfiles/filedetails/?id="
    assert parse_query(link + "3821607033") == ("items", ["3821607033"])
    # a pasted post: every link in it, in order (main drops repeats once collections expand)
    post = f"{link}5\n{link}6, {link}5 https://steamcommunity.com/workshop/filedetails/?id=7&x=1"
    assert parse_query(post) == ("items", ["5", "6", "5", "7"])
    assert parse_query("3821607033, 3821607034") == ("items", ["3821607033", "3821607034"])
    assert parse_query(f"Map 1: 3821607033 then {link}3821607034") == (
        "items",
        ["3821607033", "3821607034"],
    )
    # Steam's own links often put the ID after another parameter
    assert parse_query(f"{link[:-3]}l=english&id=42") == ("items", ["42"])
    assert parse_query("https://steamcommunity.com/profiles/76561199154600151/myworkshopfiles") == (
        "player",
        "76561199154600151",
    )
    assert parse_query("76561199154600151") == ("player", "76561199154600151")
    assert parse_query("https://steamcommunity.com/id/stoxy999/myworkshopfiles/") == (
        "vanity",
        "stoxy999",
    )
    # a name with a space (main joins the arguments, so quoting doesn't matter)
    assert parse_query("Acehole Viscunty") == ("name", "Acehole Viscunty")


def test_a_player_or_a_name_finds_their_maps_oldest_first():
    assert [m["pfid"] for m in match(MAPS, ("player", "765"))] == ["1", "3"]
    # the in-game name in any case, never a title (another maker's "Jackson's")
    assert [m["pfid"] for m in match(MAPS, ("name", "action jackson"))] == ["1", "3"]
    assert [m["pfid"] for m in match(MAPS, ("name", "jackson"))] == ["1", "3"]
    # or the Steam name, when it is known
    personas = {"762": "Acehole Viscunty"}
    assert [m["pfid"] for m in match(MAPS, ("name", "acehole"), personas=personas)] == ["4"]


def test_items_keep_their_order_and_a_collection_its_own():
    # a collection's ID stands for its children, a Map's for itself
    expanded = ["3", "2", "1"]
    assert [m["pfid"] for m in match(MAPS, ("items", expanded))] == ["3", "2", "1"]


def test_the_campaign_line_is_ready_to_paste():
    assert campaign_line(MAPS[:2]) == 'maps: ["3", "1"],'


def test_curated_ids_reads_campaigns_ts():
    source = 'maps: ["3605138459", "3607096927"],\n  maps: [\n    "3612357898",\n  ],'
    assert curated_ids(source) == {"3605138459", "3607096927", "3612357898"}


def test_a_map_page_says_whether_the_site_lists_the_map():
    # the site's page for a Map the collector hasn't listed yet is a soft not-found: it
    # answers 200 like any other, and only its robots tag tells them apart
    listed = '<title>stoxy&#x27;s mini golf 009 · Ballest of Them All</title><meta name="x"/>'
    unlisted = '<title>Ballest of Them All</title><meta name="robots" content="noindex"/>'
    assert listed_on_site(listed)
    assert not listed_on_site(unlisted)
    assert not listed_on_site('<meta content="noindex, follow" name="robots"/>')


def test_the_json_report_carries_each_map_and_whether_the_site_lists_it():
    found = [MAPS[1], MAPS[0]]
    out = report(found, site=[True, None], missing=["9"])
    assert out["missing"] == ["9"]
    assert out["maps"] == [
        {
            "pfid": "1",
            "title": "Hydro 1",
            "creator": "Action Jackson",
            "cid": "765",
            "created": 100,
            "on_site": True,
        },
        {
            "pfid": "3",
            "title": "Hydro 3",
            "creator": "Action Jackson",
            "cid": "765",
            "created": 300,
            "on_site": None,
        },
    ]
