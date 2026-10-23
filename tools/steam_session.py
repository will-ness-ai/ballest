"""
The collector's one Steam session (ADR 0014): a single login that every job the service runs
shares, the Refresh, the file downloads and the Daily read alike. A second login on the
account drops the first, so the service never makes one.

It logs in when a job first needs Steam (`ready`, `send`) and stays logged in. A login that
fails (a bad token, Steam down) is tried again every RETRY seconds with a fresh client, and so
is one whose connection drops or whose request goes unanswered: steam.py's own reconnect
leaves its cached socket pointing at the dead one, so the session never relies on it. It tells
no one: a Steam outage reaches ops through the Daily read that fails every minute meanwhile
(runner.py). Leaderboard requests go through `send`, one at a time, since the CM silently
drops replies with several in flight, and so do a file download's requests (`call`), each
with REQUEST_TIMEOUT. Once Steam has been down READY_TIMEOUT, a job asking for it fails at
once.

A script run on its own (`python tools/steampy_collect.py`) uses `run_alone`, which logs off
when its one job ends.
"""

import asyncio
import contextlib
import contextvars
import logging
import time
import warnings

warnings.filterwarnings("ignore")  # silence steam.py's XML-as-HTML parser warning

import campaign_common as cc  # noqa: E402
import steam  # noqa: E402 (after the warnings filter)

# seconds a leaderboard request may take, and a job may wait for a login
REQUEST_TIMEOUT = 60
READY_TIMEOUT = 5 * 60
# seconds between a failed login and the next try, and between a login that worked and
# dropped and its fresh one
RETRY = 60
RELOGIN = 5
# seconds a fresh client may take to log in before it is dropped for another: steam.py's own
# CM retries can wedge (seen live, 2026-10-23)
LOGIN_DEADLINE = 90

logging.basicConfig(level=logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.CRITICAL)  # hush benign teardown noise


class SteamSession:
    """One logged-in steam.py client, shared. `make_client()` makes a steam.Client."""

    def __init__(self, token, *, make_client=None, sleep=asyncio.sleep):
        self.token, self.sleep = token, sleep
        self.make_client = make_client or steam.Client
        self.client = None
        self.logins = 0
        # logged in on the current client; down since (monotonic) it last wasn't, and why
        self.up = False
        self.down = None
        self._down_since = 0.0
        self._task = None
        self._dropped = asyncio.Event()
        self._closing = False
        self._one_at_a_time = asyncio.Lock()

    async def ready(self):
        """The logged-in client, logging in first if nothing has yet. A login's retry is
        waited out, up to READY_TIMEOUT (TimeoutError); once Steam has been down that long,
        it raises ConnectionError straight away, so a short drop still waits."""
        if self._task is None:
            self._down_since = time.monotonic()
            # its own context: what the login prints belongs to no job (runner.JobLog)
            self._task = asyncio.create_task(self._hold(), context=contextvars.Context())
        async with asyncio.timeout(READY_TIMEOUT):
            # polled: a fresh client after each drop, and none has an event for that
            while not self.up:
                if time.monotonic() - self._down_since >= READY_TIMEOUT:
                    raise ConnectionError(f"Steam down: {self.down or 'not logged in yet'}")
                await asyncio.sleep(0.2)
        return self.client

    async def call(self, request):
        """`await request(client)` on the logged-in client, after any request ahead of it
        has its reply, within REQUEST_TIMEOUT once sent: every request to the CM goes through
        here, a leaderboard read's or a file download's alike."""
        await self.ready()  # a login is waited out side by side, not one caller after another
        async with self._one_at_a_time:
            client = await self.ready()  # at once, unless the request ahead dropped the client
            async with asyncio.timeout(REQUEST_TIMEOUT):
                return await request(client)

    async def send(self, msg):
        """Sends one raw protobuf request to the CM and returns its reply (steampy_common's
        leaderboard requests). One left unanswered drops the client for a fresh login."""
        client = None

        def raw(c):
            nonlocal client
            client = c
            return c._state.ws.send_proto_and_wait(msg)  # noqa: SLF001 (steam.py has no public raw-protobuf call)

        try:
            return await self.call(raw)
        except TimeoutError:
            if client is not None:  # sent, never answered (not a wait for the login)
                self._drop(client, "a request went unanswered")
            raise

    async def _hold(self):
        while not self._closing:
            try:
                worked = await self._one_login()
            except Exception as e:  # never let the session stop logging in
                print(f"Steam: the login loop failed: {e!r}", flush=True)
                self._went_down(e)
                worked = False
            if self._closing:
                return
            wait = RELOGIN if worked else RETRY
            print(f"Steam: logging in again in {wait} s", flush=True)
            await self.sleep(wait)

    async def _one_login(self):
        """One client, from its login until it is dropped or its login ends: whether it
        logged in."""
        client = self.client = self.make_client()
        self._dropped.clear()
        logins = self.logins
        self._on_events(client)
        login = asyncio.create_task(self._login(client))
        dropped = asyncio.create_task(self._dropped.wait())
        deadline = asyncio.create_task(self._login_deadline(client, logins))
        await asyncio.wait({login, dropped}, return_when=asyncio.FIRST_COMPLETED)
        dropped.cancel()
        deadline.cancel()
        if not login.done():  # dropped: this client's socket is dead to us
            with contextlib.suppress(Exception):
                await client.close()
            with contextlib.suppress(Exception, asyncio.CancelledError, TimeoutError):
                await asyncio.wait_for(login, 30)
        worked = self.logins > logins
        if self._closing:
            return worked  # steam.py often raises on the teardown after close()
        failed = None if login.cancelled() else login.exception()
        if worked:
            # what steam.py raises as a working login's connection closes is no login failure
            self._went_down(self.down or "connection dropped")
        else:
            print(f"Steam: logging in failed: {failed!r}", flush=True)
            self._went_down(failed or "the login ended")
        return worked

    async def _login_deadline(self, client, logins):
        await asyncio.sleep(LOGIN_DEADLINE)
        if self.logins == logins:
            self._drop(client, f"no login within {LOGIN_DEADLINE} s")

    async def _login(self, client):
        async with client:
            await client.login(refresh_token=self.token)

    def _went_down(self, why):
        if self.up:
            self._down_since = time.monotonic()
        self.up, self.down = False, why

    def _drop(self, client, why):
        """Gives up on `client` (its connection dropped, or a request went unanswered): it is
        closed and replaced with a fresh login."""
        if client is self.client and not self._dropped.is_set():
            print(f"Steam: {why}; dropping this login", flush=True)
            self._went_down(why)
            self._dropped.set()

    def _on_events(self, client):
        @client.event
        async def on_ready():
            # steam.py calls this twice a login, and early on its own reconnect, never used
            if client is self.client and not self.up and not self._dropped.is_set():
                self.logins += 1
                self.up, self.down = True, None
                print(
                    f"Steam: logged in (login {self.logins} since the service started)", flush=True
                )

        @client.event
        async def on_disconnect():
            self._drop(client, "connection dropped")

    async def close(self):
        """Logs off and stops logging in again."""
        self._closing = True
        self.up = False
        if self.client is not None:
            with contextlib.suppress(Exception):
                await self.client.close()
        if self._task is not None:
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await asyncio.wait_for(self._task, 30)


def run_alone(job, **kw):
    """Runs `await job(session)` to its exit code as a script on its own: logged in for that
    one job and off after, or exit 2 with no STEAM_REFRESH_TOKEN."""
    token = cc.load_refresh_token()
    if not token:
        print("ERROR: STEAM_REFRESH_TOKEN not set. Mint one with tools/steampy_mint.py.")
        return 2

    async def go():
        session = SteamSession(token, **kw)
        try:
            return await job(session)
        finally:
            await session.close()

    return asyncio.run(go())
