"""The collector's Map file step (tools/map_files.py): which Maps' files a Refresh downloads,
in what order, and that each is kept as it arrives while a failed download changes nothing.
Steam's download is faked; the database is real."""

import asyncio
import contextlib
import gzip
import io
import json
from datetime import UTC, datetime

import campaign_common as cc
import map_files
import psycopg
import pytest

T0 = datetime(2026, 10, 17, tzinfo=UTC)
# The opening bytes of two real .ballmap files, downloaded from Steam on 2026-10-17 by the
# prototype's Actions run (prototype-maps/fetch.py on branch claude/prototype-maps3d): "the
# drop" (3796494598) and "Brand New TV Offer v2" (3802991891). A real file goes on to the
# Map's items; the step only looks at how a file starts and stores the bytes it is given.
BALLMAP = (
    b'{\n\t"worldSettings":\n\t{\n\t\t"directionalLight":\n\t\t{\n\t\t\t"timeOfDay": 0,'
    b'\n\t\t\t"brightness": 2\n\t\t},'
)
BALLMAP_V2 = (
    b'{\n\t"worldSettings":\n\t{\n\t\t"directionalLight":\n\t\t{\n\t\t\t"timeOfDay": 0,'
    b'\n\t\t\t"brightness": 8\n\t\t},'
)


def cat(pfid, version, subs):
    """A catalogue Map as workshop_catalogue returns it, cut to what the step reads."""
    return {"pfid": pfid, "title": "Map " + pfid, "version": version, "subs": subs}


# QueryFiles' item for Slick Slide, captured 2026-10-17 (return_metadata=1,
# return_playtime_stats=1; total 1521), cut to the fields the catalogue reads
SLICK_SLIDE = {
    "publishedfileid": "3821728582",
    "creator": "76561198059105173",
    "title": "Slick Slide",
    "preview_url": "https://images.steamusercontent.com/ugc/13541795060496977879/"
    "9856FB2CFE88960FB2C2EAFAA30B1475BA12959A/",
    "time_created": 1792264995,
    "metadata": json.dumps(
        {
            "ballest": {
                "creator_name": "xMetzger",
                "leaderboard_name_current": "ballest_v0_3821728582_Climb_Slick Slide",
                "level_display_name": "Slick Slide",
                "medal_times_by_index": [39, 30, 26, 24.340808868408203],
            }
        }
    ),
    "lifetime_playtime_sessions": "0",
    "lifetime_subscriptions": 1,
    "hcontent_file": "5264165870500067685",
    "file_size": "189791",
    "file_url": None,
}


def test_the_catalogue_gives_each_maps_file_version_and_size(monkeypatch):
    pages = iter(
        [
            {"response": {"total": 1, "publishedfiledetails": [SLICK_SLIDE], "next_cursor": "A"}},
            {"response": {"total": 1, "publishedfiledetails": []}},
        ]
    )
    monkeypatch.setattr(
        cc.urllib.request,
        "urlopen",
        lambda _url, **_: contextlib.nullcontext(io.BytesIO(json.dumps(next(pages)).encode())),
    )
    monkeypatch.setattr(cc.time, "sleep", lambda _: None)
    (m,) = cc.workshop_catalogue("KEY")
    assert (m["pfid"], m["version"], m["file_size"]) == (
        "3821728582",
        "5264165870500067685",
        189791,
    )


def test_due_is_every_map_with_no_file_most_subscribed_first(conn):
    catalogue = [cat("1", "h1", 10), cat("2", "h2", 300), cat("3", "h3", 50)]
    assert [m["pfid"] for m in map_files.due(conn, catalogue)] == ["2", "3", "1"]


def stored(conn):
    return {
        pfid: (version, raw_size, gzip.decompress(gz))
        for pfid, version, raw_size, gz in conn.execute(
            "select pfid, version, raw_size, gzipped from map_files"
        ).fetchall()
    }


def test_a_written_file_is_kept_gzipped_and_not_due_again(conn):
    map_files.write(conn, cat("1", "h1", 10), BALLMAP, T0)
    assert stored(conn) == {"1": ("h1", len(BALLMAP), BALLMAP)}
    assert map_files.due(conn, [cat("1", "h1", 10)]) == []


def test_a_changed_version_is_due_and_replaces_the_old_file(conn):
    map_files.write(conn, cat("1", "h1", 10), BALLMAP, T0)
    assert [m["pfid"] for m in map_files.due(conn, [cat("1", "h2", 10)])] == ["1"]
    map_files.write(conn, cat("1", "h2", 10), BALLMAP_V2, T0)
    assert stored(conn) == {"1": ("h2", len(BALLMAP_V2), BALLMAP_V2)}


# The opening bytes of a Map's preview picture as its manifest holds it: "the drop"
# (3796494598), fetched from Steam by the prototype's first Actions run on 2026-10-17, which
# saved every manifest's first file (commit 5f25771d on claude/prototype-maps3d).
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"


def test_the_map_file_is_the_manifest_entry_that_starts_like_json():
    assert map_files.map_file([JPEG, BALLMAP]) == BALLMAP
    # None of the 18 files the prototype captured opens with a UTF-8 BOM, but a JSON file may,
    # and the prototype's fetch accepted one too: here the BOM goes before the real bytes.
    bom = b"\xef\xbb\xbf" + BALLMAP
    assert map_files.map_file([bom, JPEG]) == bom


def test_a_manifest_with_no_map_file_raises():
    with pytest.raises(map_files.NoMapFileError):
        map_files.map_file([JPEG, b""])


def test_a_map_the_catalogue_gives_no_version_is_never_due(conn):
    # QueryFiles writes a missing handle as "0"
    assert map_files.due(conn, [cat("1", None, 10), cat("2", "0", 10)]) == []


# FakePath and FakeClient are shaped after steamio 1.1.3's API (Client.fetch_published_files,
# PublishedFile.manifest, Manifest.paths, a path's is_file and read_bytes) as the prototype's
# fetch run used it to download the files above (prototype-maps/fetch.py on branch
# claude/prototype-maps3d), where a manifest lists directories as well as files.
class FakePath:
    """A steam.py manifest path: a file or a directory, and the file's bytes."""

    def __init__(self, data=None):
        self.data = data

    def is_file(self):
        return self.data is not None

    async def read_bytes(self):
        return self.data


class FakeClient:
    """The calls steam_download makes on steam.py's Client (steamio 1.1.3)."""

    def __init__(self, paths):
        self.paths = paths
        self.asked = []

    async def fetch_published_files(self, *ids):
        self.asked.extend(ids)
        manifest = type("Manifest", (), {"paths": self.paths})()

        class PublishedFile:
            async def manifest(self):
                return manifest

        # list[PublishedFile | None]: None for an ID Steam has no file for
        return [None if self.paths is None else PublishedFile() for _ in ids]


def test_the_steam_download_reads_the_map_file_from_the_maps_manifest():
    client = FakeClient([FakePath(), FakePath(JPEG), FakePath(BALLMAP)])
    assert asyncio.run(map_files.steam_download(client)("3821728582")) == BALLMAP
    assert client.asked == [3821728582]
    with pytest.raises(map_files.NoMapFileError):
        asyncio.run(map_files.steam_download(FakeClient([FakePath(JPEG)]))("1"))
    with pytest.raises(LookupError):  # Steam has no such published file now
        asyncio.run(map_files.steam_download(FakeClient(None))("1"))


def fake_download(files, calls=None):
    """Steam's download: each pfid's file, or the error its download raises."""

    async def download(pfid):
        if calls is not None:
            calls.append(pfid)
        got = files[pfid]
        if isinstance(got, Exception):
            raise got
        return got

    return download


def test_collect_writes_each_file_and_a_failed_download_keeps_the_old_one(conn):
    map_files.write(conn, cat("2", "old", 5), BALLMAP, T0)
    todo = [cat("1", "h1", 9), cat("2", "new", 5), cat("3", "h3", 1)]
    files = {"1": BALLMAP, "2": OSError("connection dropped"), "3": map_files.NoMapFileError()}
    written, failed = asyncio.run(map_files.collect(conn, todo, fake_download(files)))
    assert written == 1
    assert failed == {"OSError": 1, "NoMapFileError": 1}
    assert stored(conn) == {"1": ("h1", len(BALLMAP), BALLMAP), "2": ("old", len(BALLMAP), BALLMAP)}
    # both failures are tried again next run
    assert [m["pfid"] for m in map_files.due(conn, todo)] == ["2", "3"]


def test_collect_starts_nothing_once_the_budget_is_spent_and_keeps_what_it_wrote(conn):
    now = [0.0]

    async def download(_pfid):
        now[0] += 10
        return BALLMAP

    todo = [cat("1", "h1", 9), cat("2", "h2", 5), cat("3", "h3", 1)]
    written, _ = asyncio.run(
        map_files.collect(conn, todo, download, budget=5, workers=1, clock=lambda: now[0])
    )
    assert written == 1
    assert set(stored(conn)) == {"1"}


def test_the_step_downloads_only_new_or_changed_files_and_revalidates(db_url, capsys):
    with psycopg.connect(db_url, autocommit=True) as conn:
        map_files.write(conn, cat("1", "h1", 9), BALLMAP, T0)
    calls = []
    catalogue = [cat("1", "h1", 9), cat("2", "h2", 5), cat("3", "h3", 50)]
    files = {"2": BALLMAP, "3": OSError("timeout")}
    n = asyncio.run(
        map_files.record_map_files(
            catalogue, fake_download(files, calls), env={"DATABASE_URL": db_url}
        )
    )
    assert n == 1
    assert calls == ["3", "2"]  # most subscribed first; "1" is unchanged
    out = capsys.readouterr().out
    assert "2 due, 1 written, 1 failed (OSError 1)" in out
    assert "not revalidating" in out  # it tried: no SITE_URL in this env


def test_a_step_that_writes_nothing_does_not_revalidate(db_url, capsys):
    catalogue = [cat("1", "h1", 9)]
    n = asyncio.run(
        map_files.record_map_files(
            catalogue, fake_download({"1": OSError()}), env={"DATABASE_URL": db_url}
        )
    )
    assert n == 0
    assert "revalidat" not in capsys.readouterr().out


def test_dev_writes_only_the_dev_database(db_url):
    env = {"DATABASE_URL": "postgres://nobody@127.0.0.1:1/prod", "DEV_DATABASE_URL": db_url}
    download = fake_download({"1": BALLMAP})
    n = asyncio.run(
        map_files.record_map_files([cat("1", "h1", 9)], download, env=env, scratch=True)
    )
    assert n == 1
    with psycopg.connect(db_url) as conn:
        assert set(stored(conn)) == {"1"}


def test_the_step_is_skipped_without_a_catalogue_or_a_database(capsys):
    download = fake_download({})
    assert (
        asyncio.run(map_files.record_map_files(None, download, env={"DATABASE_URL": "x"})) is None
    )
    assert asyncio.run(map_files.record_map_files([cat("1", "h", 1)], download, env={})) is None
    assert "skipping" in capsys.readouterr().out


def test_a_database_failure_is_a_warning_and_does_not_raise(capsys):
    env = {"DATABASE_URL": "postgres://nobody@127.0.0.1:1/none?connect_timeout=2"}
    n = asyncio.run(map_files.record_map_files([cat("1", "h", 1)], fake_download({}), env=env))
    assert n is None
    assert "::warning::" in capsys.readouterr().out


def test_the_step_takes_a_budget_for_a_backlog_run(db_url, capsys):
    calls = []
    n = asyncio.run(
        map_files.record_map_files(
            [cat("1", "h1", 9)],
            fake_download({"1": BALLMAP}, calls),
            env={"DATABASE_URL": db_url},
            budget=0,
        )
    )
    assert (n, calls) == (0, [])  # no download starts once the budget is spent
    assert "1 due, 0 written, 0 failed, 1 left" in capsys.readouterr().out


def test_maps_named_come_from_the_newest_page_and_none_from_the_whole_catalogue(monkeypatch):
    newest = [cat("1", "h1", 9), cat("2", "h2", 5), cat("3", "h3", 1)]
    monkeypatch.setattr(map_files.cc, "newest_maps", lambda _: newest)
    monkeypatch.setattr(map_files.cc, "workshop_catalogue", lambda _: [*newest, cat("4", "h4", 1)])
    assert [m["pfid"] for m in map_files.catalogue_of("key", {"3", "1"})] == ["1", "3"]
    assert len(map_files.catalogue_of("key")) == 4
    assert map_files.catalogue_of("key", set()) == []  # --maps "," names nothing, not everything


def test_maps_naming_none_on_the_newest_page_never_logs_into_steam(monkeypatch, capsys):
    monkeypatch.setattr(map_files.cc, "load_refresh_token", lambda: "token")
    monkeypatch.setattr(map_files.cc, "load_key", lambda: "key")
    monkeypatch.setattr(map_files.cc, "newest_maps", lambda _: [cat("1", "h1", 9)])
    monkeypatch.setattr(map_files.steam, "Client", None)  # calling it would raise
    env = {"DEV_DATABASE_URL": "postgres://unused"}
    monkeypatch.setattr(map_files.os, "environ", env)
    assert map_files.main(["--maps", ",", "--dev"]) == 1
    assert map_files.main(["--maps", "2", "--dev"]) == 1
    assert "no Map to look at" in capsys.readouterr().out
