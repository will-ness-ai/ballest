"""A #new-tracks post's step (db_writer.add_maps): the newest Workshop Maps the database
lacks, written so the site lists them before the next Refresh, and read back the way the
site and the collector's memory read them."""

import contextlib
import io
import json
from datetime import UTC, datetime

import add_maps
import campaign_common as cc
import db_writer
from test_map_files import SLICK_SLIDE

T0 = datetime(2026, 10, 1, tzinfo=UTC)
OLD, NEW = "3812794783", "3821808619"


def item(pfid, **kw):
    """A catalogue Map as campaign_common.catalogue_map returns it."""
    return {
        "pfid": pfid,
        "title": "Limbo campaign A08 of 8",
        "creator": "DanielProp",
        "created": 1792272393,
        "medals": [60.0, 45.0, 40.0, 35.0],
        "board": f"ballest_v0_{pfid}_Climb_Limbo",
        "cid": "76561198000000001",
        "preview": "https://example.invalid/p.jpg",
        "sessions": 3,
        "subs": 5,
        "version": "1",
        "file_size": 10,
    } | kw


def catalogue_refresh(conn, *pfids):
    """A Refresh whose catalogue listed these Maps, as the collector writes it."""
    maps = [
        {
            "name": "Workshop_" + p,
            "pfid": p,
            "display": "Jungle islands",
            "creator": "BULLTIS",
            "cid": "76561199225434643",
            "preview": "",
            "created": 1791052606,
            "medals": [71.0, 53.0, 47.0, 43.8],
            "handle": "21195816",
            "entry_count": 2,
            "sessions": 6,
            "subs": 10,
        }
        for p in pfids
    ]
    return db_writer.write_refresh(
        conn,
        db_writer.Refresh(
            started_at=T0,
            boards=[],
            workshop={"maps": maps, "boards": {}, "failed": [], "full_sweep": False},
        ),
    )


def listed(conn):
    """The Maps the site lists (web/db/boards.ts, listedMapsSql), by pfid."""
    return {
        p
        for (p,) in conn.execute(
            """
            select m.pfid from maps m join (
              select distinct on (pfid) pfid, last_seen_refresh from map_history
              order by pfid, last_seen_refresh desc, id desc) l on l.pfid = m.pfid
            where l.last_seen_refresh = (select max(last_seen_refresh) from map_history)
            """
        )
    }


def test_a_new_map_is_listed_beside_the_latest_catalogues_maps(conn):
    catalogue_refresh(conn, OLD)
    assert db_writer.add_maps(conn, [item(NEW), item(OLD)]) == [NEW]
    assert listed(conn) == {OLD, NEW}
    assert conn.execute(
        "select b.kind, b.display, b.leaderboard_id, m.creator_steam_id from maps m"
        " join boards b on b.name = m.board where m.pfid = %s",
        (NEW,),
    ).fetchone() == ("map", "Limbo campaign A08 of 8", None, "76561198000000001")


def test_a_new_map_writes_no_refresh(conn):
    catalogue_refresh(conn, OLD)
    db_writer.add_maps(conn, [item(NEW)])
    assert conn.execute("select count(*) from refreshes").fetchone() == (1,)


def test_the_next_refresh_looks_up_a_new_maps_board(conn):
    # empty counters: the collector reads them as moved, so it finds the Map's board
    catalogue_refresh(conn, OLD)
    db_writer.add_maps(conn, [item(NEW)])
    assert db_writer.read_memory(conn).maps[NEW] == {
        "handle": None,
        "entry_count": 0,
        "rows": 0,
        "sessions": None,
        "subs": None,
    }


def test_a_map_already_held_is_left_alone(conn):
    catalogue_refresh(conn, OLD)
    assert db_writer.add_maps(conn, [item(OLD, title="Renamed")]) == []
    assert conn.execute("select title from map_history where pfid = %s", (OLD,)).fetchall() == [
        ("Jungle islands",)
    ]


def test_nothing_is_added_before_any_catalogue_was_written(conn):
    assert db_writer.add_maps(conn, [item(NEW)]) == []
    assert conn.execute("select count(*) from maps").fetchone() == (0,)


# The step's loop (add_maps.add_when_listed): Steam's newest page can lag the #new-tracks post.


def test_the_step_tries_again_until_steam_lists_the_new_map():
    pages = iter([[item(OLD)], [item(OLD)], [item(NEW), item(OLD)]])
    waits = []
    added = add_maps.add_when_listed(
        lambda: next(pages), lambda c: [m["pfid"] for m in c if m["pfid"] == NEW], waits.append
    )
    assert added == [NEW]
    assert waits == [add_maps.RETRY_SECONDS] * 2


def test_the_step_gives_up_after_its_tries_and_a_failed_read_is_one_try():
    def newest():
        raise OSError("Steam is down")

    waits = []
    assert add_maps.add_when_listed(newest, lambda _: [], waits.append) == []
    assert len(waits) == add_maps.TRIES - 1


def test_the_newest_page_is_one_request_read_as_the_catalogue_reads_it(monkeypatch):
    urls = []

    def urlopen(url, **_):
        urls.append(url)
        page = {"response": {"total": 1521, "publishedfiledetails": [SLICK_SLIDE]}}
        return contextlib.nullcontext(io.BytesIO(json.dumps(page).encode()))

    monkeypatch.setattr(cc.urllib.request, "urlopen", urlopen)
    [m] = cc.newest_maps("key")
    assert len(urls) == 1
    assert "query_type=1" in urls[0]
    assert (m["pfid"], m["title"], m["creator"], m["board"]) == (
        "3821728582",
        "Slick Slide",
        "xMetzger",
        "ballest_v0_3821728582_Climb_Slick Slide",
    )
    assert m["medals"] == [39.0, 30.0, 26.0, 24.340808868408203]


# The workflow's next step downloads the added Maps' files (map_files.py --maps), so the step
# names them in its output.


def test_the_added_maps_are_named_in_the_steps_output(tmp_path):
    out = tmp_path / "github_output"
    out.write_text("earlier=1\n")
    add_maps.name_in_output([NEW, OLD], {"GITHUB_OUTPUT": str(out)})
    assert out.read_text() == f"earlier=1\nadded={NEW},{OLD}\n"


def test_outside_actions_there_is_no_output_to_name_them_in():
    add_maps.name_in_output([NEW], {})
