"""Which Dailies a Refresh looks up and reads (daily.plan): a pure function of the Dailies
the database holds, the time now and the first Daily's date. Then the API lookup
(daily.look_up), and the step's time limit (daily.collect)."""

import asyncio
import json
import threading
import time
from datetime import UTC, date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import daily
import pytest

FIRST = date(2026, 8, 20)


def at(s):
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


def a_daily(d, starts, ends, *, final=False):
    return daily.Daily(
        date=d,
        board=f"ballest_v0_9_Daily_{d.replace('-', '')}_0",
        leaderboard_id="1" + d.replace("-", ""),
        pfid="9",
        title="Map " + d,
        starts_at=at(starts),
        ends_at=at(ends),
        final=final,
    )


def midnight(d, *, final=False):
    """A Daily of the 00:00 to 00:00 UTC windows, which ran through 2026-09-04."""
    start = date.fromisoformat(d)
    return a_daily(d, f"{start}T00:00", f"{start + timedelta(days=1)}T00:00", final=final)


def one_am(d, *, final=False):
    """A Daily of the 01:00 to 01:00 UTC windows, run since 2026-09-06."""
    start = date.fromisoformat(d)
    return a_daily(d, f"{start}T01:00", f"{start + timedelta(days=1)}T01:00", final=final)


def every_date(first, last):
    n = (last - first).days + 1
    return [str(first + timedelta(days=i)) for i in range(n)]


def test_the_first_run_looks_up_every_date_since_the_first_daily():
    lookups, reads = daily.plan({}, at("2026-10-08T12:00"), FIRST)
    assert lookups == every_date(FIRST, date(2026, 10, 8))
    assert len(lookups) == 50
    assert reads == []


def held(*dailies):
    return {d.date: d for d in dailies}


def caught_up(now, *recent):
    """Every Daily from the first through 2026-10-05 final, plus `recent`."""
    past = [midnight(d, final=True) for d in every_date(FIRST, date(2026, 9, 4))]
    past.append(a_daily("2026-09-05", "2026-09-05T00:00", "2026-09-06T01:00", final=True))
    past += [one_am(d, final=True) for d in every_date(date(2026, 9, 6), date(2026, 10, 5))]
    return daily.plan(held(*past, *recent), now, FIRST)


def test_a_final_daily_is_never_read_or_looked_up_again():
    lookups, reads = caught_up(
        at("2026-10-07T12:00"), one_am("2026-10-06", final=True), one_am("2026-10-07")
    )
    assert lookups == []
    assert [d.date for d in reads] == ["2026-10-07"]


def test_yesterdays_daily_is_read_until_a_read_after_its_close_makes_it_final():
    # 2026-10-06's window closes at 2026-10-07 01:00; the database has not marked it final
    lookups, reads = caught_up(at("2026-10-07T12:00"), one_am("2026-10-06"), one_am("2026-10-07"))
    assert lookups == []
    assert [d.date for d in reads] == ["2026-10-06", "2026-10-07"]


def test_a_daily_not_yet_open_is_not_read():
    # 00:30 UTC: 2026-10-07's Daily opens at 01:00, so only 2026-10-06's is live
    _, reads = caught_up(at("2026-10-07T00:30"), one_am("2026-10-06"), one_am("2026-10-07"))
    assert [d.date for d in reads] == ["2026-10-06"]


def test_the_25_hour_window_and_the_1am_windows_keep_their_own_dates():
    long_day = a_daily("2026-09-05", "2026-09-05T00:00", "2026-09-06T01:00")
    first_1am = one_am("2026-09-06")
    known = held(*[midnight(d, final=True) for d in every_date(FIRST, date(2026, 9, 4))])
    # 00:30 on 09-06: 09-05's long window is still open, 09-06's has not begun
    lookups, reads = daily.plan(known | held(long_day, first_1am), at("2026-09-06T00:30"), FIRST)
    assert (lookups, [d.date for d in reads]) == ([], ["2026-09-05"])
    # 12:00: both open or just closed, each read under its own date
    lookups, reads = daily.plan(known | held(long_day, first_1am), at("2026-09-06T12:00"), FIRST)
    assert (lookups, [d.date for d in reads]) == ([], ["2026-09-05", "2026-09-06"])


def test_a_date_the_api_had_no_daily_for_is_looked_up_again_next_run():
    # 2026-10-07 came back found: false last run, so the database holds nothing for it
    lookups, _ = caught_up(at("2026-10-07T12:00"), one_am("2026-10-06", final=True))
    assert lookups == ["2026-10-07"]


# The developers' API (daily.look_up), against a fake of it on localhost.

KEY = "test-key-not-a-real-one"
CHALLENGE = {
    "date": "2026-09-05",
    "published_file_id": "3790000005",
    "level_display_name": "Long Day",
    "starts_at": "2026-09-05T00:00:00.000Z",
    "ends_at": "2026-09-06T01:00:00.000Z",
    "leaderboard_name": "ballest_v0_3790000005_Daily_20260905_1a2b3c4d",
    "leaderboard_id": "20800005",
}


@pytest.fixture
def api():
    """A fake API at a URL prefix the date is appended to: answers with `answers[date]` (a
    body, or an HTTP status), and records each request's path and key."""
    seen, answers = [], {}

    class Api(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append((self.path, self.headers.get("BallestAPIKey")))
            body = answers.get(self.path.rsplit("/", 1)[-1], {"ok": True, "found": False})
            if isinstance(body, int):
                self.send_response(body)
                self.end_headers()
                return
            out = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *_):
            pass

    server = HTTPServer(("127.0.0.1", 0), Api)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/daily/", answers, seen
    server.shutdown()
    server.server_close()


def test_a_found_daily_comes_back_as_the_api_names_it(api):
    url, answers, seen = api
    answers["2026-09-05"] = {"ok": True, "found": True, "challenge": CHALLENGE}
    d = daily.look_up(url, KEY, "2026-09-05")
    assert seen == [("/daily/2026-09-05", KEY)]
    assert d == daily.Daily(
        date="2026-09-05",
        board="ballest_v0_3790000005_Daily_20260905_1a2b3c4d",
        leaderboard_id="20800005",
        pfid="3790000005",
        title="Long Day",
        starts_at=at("2026-09-05T00:00"),
        ends_at=at("2026-09-06T01:00"),
    )


def test_a_date_with_no_daily_is_none(api):
    url, _, _ = api
    assert daily.look_up(url, KEY, "2026-08-19") is None


def test_a_failed_lookup_says_why_without_the_key_or_the_url(api):
    url, answers, _ = api
    answers["2026-09-05"] = 503
    with pytest.raises(daily.LookupFailed) as e:
        daily.look_up(url, KEY, "2026-09-05")
    assert "503" in str(e.value)
    assert KEY not in str(e.value)
    assert "127.0.0.1" not in str(e.value)
    answers["2026-09-05"] = {"ok": False}
    with pytest.raises(daily.LookupFailed):
        daily.look_up(url, KEY, "2026-09-05")


def test_a_host_that_cannot_be_reached_is_not_named_either():
    with pytest.raises(daily.LookupFailed) as e:
        daily.look_up("https://api.invalid/daily/", KEY, "2026-09-05", timeout=5)
    assert "api.invalid" not in str(e.value)
    assert KEY not in str(e.value)


# The Daily step's time limit (daily.collect), on a fake clock that each call moves on.

NOW = at("2026-10-08T12:00")


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class Fakes:
    """look_up and read that take `look_up_s` / `read_s` of the clock's time each, and a
    sleep that moves it on; a date in `found` has a Daily, any other has none. Each records
    what it was asked."""

    def __init__(self, clock, *, look_up_s=0.0, read_s=0.0, found=()):
        self.clock, self.look_up_s, self.read_s, self.found = clock, look_up_s, read_s, found
        self.asked, self.read = [], []

    async def look_up_fn(self, d):
        self.asked.append(d)
        self.clock.t += self.look_up_s
        return one_am(d) if d in self.found else None

    async def read_fn(self, d):
        self.read.append(d.date)
        self.clock.t += self.read_s
        return daily.DailyRead(daily=d, rows=[{"steam_id": "1"}], read_at=NOW)

    async def sleep(self, s):
        self.clock.t += s

    def collect(self, lookups, reads, **kw):
        return asyncio.run(
            daily.collect(
                lookups,
                reads,
                NOW,
                look_up=self.look_up_fn,
                read=self.read_fn,
                clock=self.clock,
                sleep=self.sleep,
                **kw,
            )
        )


def test_the_held_dailies_are_read_first_then_each_one_found():
    f = Fakes(Clock(), look_up_s=1, read_s=1, found={"2026-10-07"})
    out, missing, cut = f.collect(["2026-10-07", "2026-10-08"], [one_am("2026-10-06")], pace=1)
    assert f.asked == ["2026-10-07", "2026-10-08"]
    assert f.read == ["2026-10-06", "2026-10-07"]
    assert [r.daily.date for r in out] == ["2026-10-06", "2026-10-07"]
    assert (missing, cut) == (["2026-10-08"], False)


def test_a_slow_api_stops_the_step_at_its_budget_with_what_it_has():
    # each lookup takes 100 s: by 300 s three are done, and nothing more is asked or read
    dates = every_date(date(2026, 9, 1), date(2026, 9, 10))
    f = Fakes(Clock(), look_up_s=100, read_s=1, found=set(dates))
    out, missing, cut = f.collect(dates, [one_am("2026-10-06")], budget=300)
    assert f.asked == dates[:3]
    assert f.read == ["2026-10-06"]
    assert [r.daily.date for r in out] == ["2026-10-06"]
    assert (missing, cut) == ([], True)


def test_a_call_that_hangs_is_abandoned_at_the_budget():
    async def hang(_):
        await asyncio.sleep(60)

    started = time.monotonic()
    out, missing, cut = asyncio.run(
        daily.collect([], [one_am("2026-10-06")], NOW, look_up=hang, read=hang, budget=0.2)
    )
    assert time.monotonic() - started < 5
    assert (out, missing, cut) == ([], [], True)
