"""The collector's Ghost step (tools/ghosts.py): what a Ghost's fields say, which Ghosts a
Refresh reads, and that a failed read is tried again while a final one never is. Steam is
faked; the database is real."""

import io
import urllib.error
import urllib.request
from datetime import UTC, datetime

import db_writer
import ghosts
import psycopg
import pytest

T0 = datetime(2026, 10, 1, tzinfo=UTC)
PINK = "/Game/Art/Materials/Instances/Ball/MI_BallPink.MI_BallPink"

# Real field values (prototype/skins/notes.md on branch claude/prototype-skins)
COSMIC = {
    "elapsedTime": [0.1, 0.2],
    "skinMaterial": "/Script/Engine.MaterialInstanceConstant'/Game/Packs/Vefects/Stylized_Galaxy"
    "_Shader/Galaxy/Materials/MI_VFX_Lush_Galaxy_Shader_02.MI_VFX_Lush_Galaxy_Shader_02'",
    "?SpecialSkinClass": "None",
    "accessory": "/Script/Engine.StaticMesh'/Game/Art/Props/Player/CatEars/SM_CatEars_Combined"
    ".SM_CatEars_Combined'",
}
SNOW_GLOBE = {
    "elapsedTime": [0.1],
    "skinMaterial": "None",
    "?SpecialSkinClass": "/Script/Engine.BlueprintGeneratedClass'/Game/Art/VFX"
    "/SkinChildActors/BP_SnowGlobeSkin.BP_SnowGlobeSkin_C'",
    "accessory": "None",
}
# from before ?SpecialSkinClass and ballerSkinPrefs were written
OLD = {"elapsedTime": [0.1], "skinMaterial": f"/Script/Engine.MaterialInstanceConstant'{PINK}'"}
EMPTY = {"elapsedTime": [], "skinMaterial": "None", "accessory": "None"}


def test_a_ghost_names_its_skin_and_hat():
    g = ghosts.parse("1", COSMIC)
    assert g.state == "ok"
    assert g.skin.endswith("MI_VFX_Lush_Galaxy_Shader_02.MI_VFX_Lush_Galaxy_Shader_02")
    assert g.hat == "/Game/Art/Props/Player/CatEars/SM_CatEars_Combined.SM_CatEars_Combined"


def test_a_skin_with_no_material_is_its_actor_class():
    assert ghosts.parse("1", SNOW_GLOBE).skin == (
        "/Game/Art/VFX/SkinChildActors/BP_SnowGlobeSkin.BP_SnowGlobeSkin_C"
    )


def test_an_old_ghost_without_the_newer_fields_still_names_its_skin():
    assert ghosts.parse("1", OLD) == ghosts.Ghost("1", "ok", PINK, None)


def test_a_ghost_with_no_samples_is_empty():
    assert ghosts.parse("1", EMPTY) == ghosts.Ghost("1", "empty")


def test_a_read_asks_for_the_file_then_reads_it():
    urls = []

    def get(url):
        urls.append(url)
        return {"data": {"url": "https://cdn/1"}} if "GetUGCFileDetails" in url else OLD

    assert ghosts.read("KEY", "77", get=get).skin == PINK
    assert "ugcid=77" in urls[0]
    assert "appid=3339810" in urls[0]
    assert urls[1] == "https://cdn/1"


def test_a_file_steam_does_not_have_is_gone_and_anything_else_fails():
    with pytest.raises(ghosts.GoneError):
        ghosts.read("KEY", "1", get=lambda _: {"status": {"code": 9}})
    with pytest.raises(RuntimeError):
        ghosts.read("KEY", "1", get=lambda _: {"status": {"code": 2}})


def test_steam_answers_a_missing_file_with_a_404_whose_body_says_so(monkeypatch):
    def urlopen(url, **_):
        body = b'{"status":{"code":9}}' if "missing" in url else b"{}"
        raise urllib.error.HTTPError(
            url, 404 if "missing" in url else 400, "", {}, io.BytesIO(body)
        )

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    with pytest.raises(ghosts.GoneError):
        ghosts.read("KEY", "missing")
    # an error with a body that says nothing is a failed read, tried again next time
    with pytest.raises(RuntimeError):
        ghosts.read("KEY", "1")


def rows(*runs):
    return [
        {
            "rank": i + 1,
            "steam_id": sid,
            "score_ms": score,
            "time": "",
            "ugc_id": ugc,
            "persona": "p" + sid,
            "avatar": "",
            "profileurl": "",
        }
        for i, (sid, score, ugc) in enumerate(runs)
    ]


def board(name, *runs):
    return {"name": name, "group": "Season 1", "entry_count": len(runs), "rows": rows(*runs)}


def seed(conn):
    db_writer.write_refresh(
        conn,
        db_writer.Refresh(
            started_at=T0,
            boards=[
                # slower first in the file: the step ranks by score, not by file order
                board("Map_Track13", ("2", 200, "u2"), ("1", 100, "u1"), ("3", 300, None)),
                board("Map_Track15", ("1", 100, "u1"), ("4", 50, str(2**64 - 1))),
                board("OverallLeaderboard_S1", ("1", 9000, "u9")),
            ],
        ),
    )


def test_due_is_the_top_runs_of_time_boards_with_a_ghost_best_first(conn):
    seed(conn)
    # no UGC ID, the "no file" ID and an Overall board's are never read; u1 once
    assert ghosts.due(conn) == ["u1", "u2"]


def test_due_reads_only_the_top_of_each_board(conn, monkeypatch):
    seed(conn)
    monkeypatch.setattr(ghosts, "TOP", 1)
    assert ghosts.due(conn) == ["u1"]


def test_a_written_ghost_is_never_due_again(conn):
    seed(conn)
    ghosts.write(conn, [ghosts.Ghost("u1", "ok", PINK)], T0)
    assert ghosts.due(conn) == ["u2"]


def test_collect_keeps_reads_and_gone_files_and_counts_failures():
    def read_one(u):
        if u == "gone":
            raise ghosts.GoneError(u)
        if u == "bad":
            raise OSError("timeout")
        return ghosts.Ghost(u, "ok", PINK)

    out, failed = ghosts.collect(["a", "gone", "bad", "b"], read_one, workers=2)
    assert set(out) == {
        ghosts.Ghost("a", "ok", PINK),
        ghosts.Ghost("gone", "gone"),
        ghosts.Ghost("b", "ok", PINK),
    }
    assert failed == {"OSError": 1}


def test_collect_starts_nothing_once_the_budget_is_spent():
    now = [0.0]

    def read_one(u):
        now[0] += 10
        return ghosts.Ghost(u, "ok")

    out, _ = ghosts.collect(["a", "b", "c"], read_one, budget=5, workers=1, clock=lambda: now[0])
    assert [g.ugc_id for g in out] == ["a"]


def test_the_step_writes_what_it_read_and_a_failed_read_stays_due(db_url, capsys):
    with psycopg.connect(db_url, autocommit=True) as conn:
        seed(conn)

    def read_one(u):
        if u == "u2":
            raise OSError("timeout")
        return ghosts.Ghost(u, "ok", PINK)

    n = ghosts.record_ghosts(env={"DATABASE_URL": db_url}, key="KEY", read_one=read_one)
    assert n == 1
    with psycopg.connect(db_url) as conn:
        assert conn.execute("select ugc_id, state, skin from ghosts").fetchall() == [
            ("u1", "ok", PINK)
        ]
        assert ghosts.due(conn) == ["u2"]
    assert "1 failed (OSError 1)" in capsys.readouterr().out


def test_the_step_is_skipped_without_a_key_or_a_database(capsys):
    assert ghosts.record_ghosts(env={}, key="KEY") is None
    assert "skipping" in capsys.readouterr().out


def test_a_database_failure_is_a_warning_and_does_not_raise(capsys):
    env = {"DATABASE_URL": "postgres://nobody@127.0.0.1:1/none?connect_timeout=2"}
    assert ghosts.record_ghosts(env=env, key="KEY", read_one=lambda _: None) is None
    assert "::warning::" in capsys.readouterr().out
