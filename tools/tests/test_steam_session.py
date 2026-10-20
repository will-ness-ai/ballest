"""The collector's one Steam session (tools/steam_session.py): one login for every job, its
leaderboard requests one at a time, and a login that fails tried again."""

import asyncio
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
        self._state = types.SimpleNamespace(ws=types.SimpleNamespace(send_proto_and_wait=self.send))
        FakeClient.made.append(self)

    def event(self, fn):
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
    alerts = []

    async def alert(text):
        alerts.append(text)

    s = steam_session.SteamSession("token", make_client=make, on_down=alert, **kw)
    return s, alerts


def test_nothing_logs_in_until_a_job_needs_steam():
    async def go():
        s, _ = session()
        await asyncio.sleep(0.05)
        assert FakeClient.made == []
        assert await s.send("a") == "reply to a"
        await s.close()

    asyncio.run(go())


def test_every_request_shares_one_login_and_none_overlap():
    async def go():
        s, _ = session()
        replies = await asyncio.gather(*(s.send(n) for n in range(5)))
        assert replies == [f"reply to {n}" for n in range(5)]
        (client,) = FakeClient.made
        assert client.logins == 1
        assert client.most_in_flight == 1
        await s.close()

    asyncio.run(go())


def test_a_request_that_hangs_times_out(monkeypatch):
    monkeypatch.setattr(steam_session, "REQUEST_TIMEOUT", 0.05)

    async def go():
        s, _ = session(make=lambda: FakeClient(delay=10))
        with pytest.raises(TimeoutError):
            await s.send("a")
        await s.close()

    asyncio.run(go())


def test_a_failed_login_is_tried_again_and_ops_hears_once():
    async def go():
        clients = iter([FakeClient(fail=True), FakeClient(fail=True), FakeClient()])
        slept = []

        async def sleep(seconds):
            slept.append(seconds)

        s, alerts = session(make=lambda: next(clients), sleep=sleep)
        assert await s.send("a") == "reply to a"
        assert slept == [steam_session.RETRY] * 2
        assert len(alerts) == 1
        assert "InvalidPassword" in alerts[0]
        await s.close()

    asyncio.run(go())


def test_a_session_on_its_own_logs_off_when_its_one_job_ends():
    async def go():
        async with steam_session.logged_in("token", make_client=FakeClient) as s:
            await s.send("a")
        assert FakeClient.made[0].closed.is_set()

    asyncio.run(go())
