"""record_refresh, the collector's database step: which database it writes, and that a
database failure never stops the Refresh."""

import threading
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

import db_writer

PROD = "postgres://prod.invalid/ballest"
DEV = "postgres://localhost/dev"


def refresh():
    return db_writer.Refresh(started_at=datetime(2026, 10, 1, tzinfo=UTC))


def test_a_run_writes_database_url():
    assert db_writer.database_url({"DATABASE_URL": PROD, "DEV_DATABASE_URL": DEV}) == PROD


def test_an_out_run_writes_only_the_dev_database():
    env = {"DATABASE_URL": PROD, "DEV_DATABASE_URL": DEV}
    assert db_writer.database_url(env, scratch=True) == DEV
    assert db_writer.database_url({"DATABASE_URL": PROD}, scratch=True) is None
    # a dev URL that is production's is no dev URL
    assert (
        db_writer.database_url({"DATABASE_URL": PROD, "DEV_DATABASE_URL": PROD}, scratch=True)
        is None
    )


def test_no_url_skips_the_step(capsys):
    assert db_writer.record_refresh(refresh(), env={}) is None
    assert "skipping" in capsys.readouterr().out


def test_a_database_failure_is_logged_as_an_error_and_does_not_raise(capsys):
    env = {"DATABASE_URL": "postgres://nobody@127.0.0.1:1/none?connect_timeout=2"}
    assert db_writer.record_refresh(refresh(), env=env) is None
    assert "::error::" in capsys.readouterr().out


def test_a_written_refresh_returns_its_id(db_url):
    assert db_writer.record_refresh(refresh(), env={"DATABASE_URL": db_url}) == 1


def test_a_committed_refresh_revalidates_the_site_with_the_secret(db_url):
    seen = []

    class Site(BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append((self.path, self.headers["Authorization"]))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_):
            pass

    server = HTTPServer(("127.0.0.1", 0), Site)
    threading.Thread(target=server.handle_request, daemon=True).start()
    env = {
        "DATABASE_URL": db_url,
        "SITE_URL": f"http://127.0.0.1:{server.server_port}",
        "REVALIDATE_SECRET": "s3cret",
    }
    assert db_writer.record_refresh(refresh(), env=env) == 1
    server.server_close()
    assert seen == [("/api/revalidate", "Bearer s3cret")]


def test_a_failed_revalidate_is_only_a_warning(db_url, capsys):
    env = {"DATABASE_URL": db_url, "SITE_URL": "http://127.0.0.1:1", "REVALIDATE_SECRET": "x"}
    assert db_writer.record_refresh(refresh(), env=env) == 1
    assert "::warning::" in capsys.readouterr().out
