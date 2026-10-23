"""The collector's one Steam session (tools/steam_session.py): one login for every job, its
leaderboard requests one at a time, and a login that fails tried again."""

import asyncio
import contextvars
import types
from typing import ClassVar

import pytest
import steam_session


class FakeClient:
    """Stands in for steam.Client: logs in when told, answers each request after `delay`, and
    records how many requests were in flight at once."""

    made: ClassVar[list] = []

    def __init__(self, *, fail=False, delay=0.01):
        self.fail, self.delay = fail, delay
        self.ready, self.closed = False, asyncio.Event()
        self.in_flight = self.most_in_flight = 0
        self.logins = 0
        self.handlers = {}
        self._state = types.SimpleNamespace(ws=types.SimpleNamespace(send_proto_and_wait=self.send))
        FakeClient.made.append(self)

    def event(self, fn):
        self.handlers[fn.__name__] = fn
        return fn

    def is_ready(self):
        return self.ready

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def login(self, refresh_token):  # noqa: ARG002 (steam.Client's signature)
        self.logins += 1
        if self.fail:
            raise RuntimeError("InvalidPassword")
        self.ready = True
        if "on_ready" in self.handlers:
            await self.handlers["on_ready"]()
        await self.closed.wait()

    async def close(self):
        self.ready = False
        self.closed.set()

    async def send(self, msg):
        self.in_flight += 1
        self.most_in_flight = max(self.most_in_flight, self.in_flight)
        await asyncio.sleep(self.delay)
        self.in_flight -= 1
        return f"reply to {msg}"


@pytest.fixture(autouse=True)
def fresh():
    FakeClient.made.clear()


def session(make=FakeClient, **kw):
    return steam_session.SteamSession("token", make_client=make, **kw)


def test_nothing_logs_in_until_a_job_needs_steam():
    async def go():
        s = session()
        await asyncio.sleep(0.05)
        assert FakeClient.made == []
        assert await s.send("a") == "reply to a"
        await s.close()

    asyncio.run(go())


def test_every_request_shares_one_login_and_none_overlap():
    async def go():
        s = session()
        replies = await asyncio.gather(*(s.send(n) for n in range(5)))
        assert replies == [f"reply to {n}" for n in range(5)]
        (client,) = FakeClient.made
        assert client.logins == 1
        assert client.most_in_flight == 1
        await s.close()

    asyncio.run(go())


async def soon(_seconds):
    """The retry's sleep, cut short."""
    await asyncio.sleep(0.01)


def test_an_unanswered_request_times_out_and_the_next_gets_a_fresh_login(monkeypatch):
    # a CM that stops answering is as good as a dropped connection
    monkeypatch.setattr(steam_session, "REQUEST_TIMEOUT", 0.05)

    async def go():
        clients = iter([FakeClient(delay=10), FakeClient()])
        s = session(make=lambda: next(clients), sleep=soon)
        with pytest.raises(TimeoutError):
            await s.send("a")
        assert await s.send("b") == "reply to b"
        assert FakeClient.made[0].closed.is_set()
        await s.close()

    asyncio.run(go())


def test_a_failed_login_is_tried_again():
    async def go():
        clients = iter([FakeClient(fail=True), FakeClient(fail=True), FakeClient()])
        slept = []

        async def sleep(seconds):
            slept.append(seconds)

        s = session(make=lambda: next(clients), sleep=sleep)
        assert await s.send("a") == "reply to a"
        assert slept == [steam_session.RETRY] * 2
        await s.close()

    asyncio.run(go())


def test_a_script_on_its_own_logs_in_for_its_one_job_and_off_after(monkeypatch):
    monkeypatch.setattr(steam_session.cc, "load_refresh_token", lambda: "token")

    async def job(s):
        await s.send("a")
        return 3

    assert steam_session.run_alone(job, make_client=FakeClient) == 3
    assert FakeClient.made[0].closed.is_set()


def test_a_script_on_its_own_with_no_token_stops_at_once(monkeypatch, capsys):
    monkeypatch.setattr(steam_session.cc, "load_refresh_token", lambda: None)
    assert steam_session.run_alone(None, make_client=FakeClient) == 2
    assert "STEAM_REFRESH_TOKEN" in capsys.readouterr().out
    assert FakeClient.made == []


def test_once_logging_in_has_failed_for_a_while_jobs_stop_waiting(monkeypatch):
    # a failure or two waits for the retry; a token that stays bad fails each job at once
    monkeypatch.setattr(steam_session, "READY_TIMEOUT", 0.3)

    async def go():
        gate = asyncio.Event()

        async def sleep(_seconds):
            await gate.wait()  # the retry hasn't come yet

        s = session(make=lambda: FakeClient(fail=True), sleep=sleep)
        with pytest.raises((ConnectionError, TimeoutError)):
            await s.send("a")
        with pytest.raises(ConnectionError, match="InvalidPassword"):
            await asyncio.wait_for(s.send("b"), 0.1)
        gate.set()
        await s.close()

    asyncio.run(go())


def test_downloads_and_leaderboard_requests_never_overlap():
    async def go():
        s = session()

        async def fetch_file(client):
            return await client.send("file")

        replies = await asyncio.gather(s.send("board"), s.call(fetch_file), s.send("board"))
        assert replies == ["reply to board", "reply to file", "reply to board"]
        assert FakeClient.made[0].most_in_flight == 1
        await s.close()

    asyncio.run(go())


JOB = contextvars.ContextVar("job", default=None)


def test_the_login_belongs_to_no_job():
    # the first job to need Steam starts the login; what the login prints isn't that job's
    async def go():
        seen = []

        class Watching(FakeClient):
            async def login(self, refresh_token):
                seen.append(JOB.get())
                await super().login(refresh_token)

        s = session(make=Watching)
        JOB.set("daily")
        await s.send("a")
        assert seen == [None]
        await s.close()

    asyncio.run(go())


def test_waiting_for_the_login_holds_no_one_up():
    class SlowLogin(FakeClient):
        go_ahead = None  # an asyncio.Event, made inside the test's loop

        async def login(self, refresh_token):
            await self.go_ahead.wait()
            await super().login(refresh_token)

    async def go():
        SlowLogin.go_ahead = asyncio.Event()
        s = session(SlowLogin)
        waiting = [asyncio.create_task(s.send(n)) for n in range(2)]
        await asyncio.sleep(0.05)
        assert not s._one_at_a_time.locked()  # noqa: SLF001 (the queue the login must not hold)
        SlowLogin.go_ahead.set()
        assert await asyncio.gather(*waiting) == ["reply to 0", "reply to 1"]
        await s.close()

    asyncio.run(go())


def test_a_dropped_connection_gets_a_fresh_login():
    # steam.py's own reconnect keeps its cached socket on the dead connection
    async def go():
        s = session(sleep=soon)
        assert await s.send("a") == "reply to a"
        first = FakeClient.made[0]
        await first.handlers["on_disconnect"]()
        assert await s.send("b") == "reply to b"
        assert first.closed.is_set()
        assert len(FakeClient.made) == 2
        assert s.logins == 2
        await s.close()

    asyncio.run(go())


def test_on_ready_twice_a_login_counts_once():
    async def go():
        s = session()
        await s.send("a")
        await FakeClient.made[0].handlers["on_ready"]()
        assert s.logins == 1
        await s.close()

    asyncio.run(go())


def test_steam_down_for_a_while_fails_jobs_at_once(monkeypatch):
    # a refused login is one steam.py retries itself without raising: never logged in
    monkeypatch.setattr(steam_session, "READY_TIMEOUT", 0.3)

    class NeverIn(FakeClient):
        async def login(self, refresh_token):  # noqa: ARG002 (steam.Client's signature)
            await self.closed.wait()

    async def go():
        clients = iter([FakeClient(), NeverIn(), NeverIn()])
        s = session(make=lambda: next(clients), sleep=soon)
        await s.send("a")
        await FakeClient.made[0].handlers["on_disconnect"]()
        with pytest.raises((ConnectionError, TimeoutError)):
            await s.send("b")
        with pytest.raises(ConnectionError, match="connection dropped"):
            await asyncio.wait_for(s.send("c"), 0.1)
        await s.close()

    asyncio.run(go())


def test_a_slow_file_request_keeps_the_login(monkeypatch):
    # a manifest waits on Steam's content servers, not the CM
    monkeypatch.setattr(steam_session, "REQUEST_TIMEOUT", 0.05)

    async def go():
        s = session()
        with pytest.raises(TimeoutError):
            await s.call(lambda _c: asyncio.sleep(10))
        assert s.up
        assert len(FakeClient.made) == 1
        await s.close()

    asyncio.run(go())


def test_a_working_login_that_ends_is_a_drop_and_comes_back_quickly():
    class Dies(FakeClient):
        async def login(self, refresh_token):  # noqa: ARG002 (steam.Client's signature)
            self.ready = True
            await self.handlers["on_ready"]()
            raise RuntimeError("ConnectionClosed")  # how steam.py's login ends on a dead socket

    async def go():
        clients = iter([Dies(), FakeClient()])
        slept = []

        async def sleep(seconds):
            slept.append(seconds)

        s = session(make=lambda: next(clients), sleep=sleep)
        await s.ready()  # the first, which dies
        while s.logins < 2:  # noqa: ASYNC110 (the session has no event for a login)
            await asyncio.sleep(0.01)
        assert slept == [steam_session.RELOGIN]
        await s.close()

    asyncio.run(go())


def test_a_login_that_never_comes_is_dropped_for_a_fresh_one(monkeypatch):
    monkeypatch.setattr(steam_session, "LOGIN_DEADLINE", 0.1)

    class Wedged(FakeClient):
        async def login(self, refresh_token):  # noqa: ARG002 (steam.Client's signature)
            await self.closed.wait()

    async def go():
        clients = iter([Wedged(), FakeClient()])
        s = session(make=lambda: next(clients), sleep=soon)
        assert await s.send("a") == "reply to a"
        assert FakeClient.made[0].closed.is_set()
        await s.close()

    asyncio.run(go())
