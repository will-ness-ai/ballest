"""
The collector's one Steam session (ADR 0014): a single login that every job the service runs
shares, the Refresh, the file downloads and the Daily read alike. A second login on the
account drops the first, so the service never makes one.

It logs in when a job first needs Steam (`ready`, `send`) and stays logged in. steam.py
reconnects a dropped connection by itself; a login that fails outright (a bad token, Steam
down) is tried again every RETRY seconds with a fresh client, and `on_down` hears of it once
until a login works. Leaderboard requests go through `send`, one at a time, since the CM
silently drops replies with several in flight, each with REQUEST_TIMEOUT, so a request lost
with its connection fails instead of hanging its job.

A script run on its own (`python tools/steampy_collect.py`) uses `logged_in`, which logs off
when its one job ends.
"""

import asyncio
import contextlib
import logging
import warnings

warnings.filterwarnings("ignore")  # silence steam.py's XML-as-HTML parser warning

import steam  # noqa: E402 (after the warnings filter)

# seconds a leaderboard request may take, and a job may wait for a login
REQUEST_TIMEOUT = 60
READY_TIMEOUT = 5 * 60
# seconds between a failed login and the next try
RETRY = 60

logging.basicConfig(level=logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.CRITICAL)  # hush benign teardown noise


class SteamSession:
    """One logged-in steam.py client, shared. `make_client()` makes a steam.Client;
    `on_down(text)` is told, once, that logging in failed."""

    def __init__(self, token, *, make_client=steam.Client, on_down=None, sleep=asyncio.sleep):
        self.token, self.make_client, self.on_down, self.sleep = token, make_client, on_down, sleep
        self.client = None
        self.logins = 0
        self._task = None
        self._closing = False
        self._one_at_a_time = asyncio.Lock()

    async def ready(self):
        """The logged-in client, logging in first if nothing has yet; raises TimeoutError
        after READY_TIMEOUT. A dropped connection's reconnect is waited out the same way."""
        if self._task is None:
            self._task = asyncio.create_task(self._hold())
        async with asyncio.timeout(READY_TIMEOUT):
            # polled: a failed login swaps in a fresh client, and none has an event for that
            while not (self.client and self.client.is_ready()):  # noqa: ASYNC110
                await asyncio.sleep(0.2)
        return self.client

    async def send(self, msg):
        """Sends one raw protobuf request on the session and returns its reply, after any
        request ahead of it has its reply (steampy_common's leaderboard requests)."""
        async with self._one_at_a_time:
            client = await self.ready()
            async with asyncio.timeout(REQUEST_TIMEOUT):
                return await client._state.ws.send_proto_and_wait(msg)  # noqa: SLF001 (steam.py has no public raw-protobuf call)

    async def _hold(self):
        told = False
        while not self._closing:
            client = self.client = self.make_client()
            self._on_ready(client)
            logins = self.logins
            try:
                async with client:
                    await client.login(refresh_token=self.token)
            except Exception as e:
                if self._closing:
                    return  # steam.py often raises on the teardown after close()
                if self.logins > logins:
                    told = False  # this client was logged in before it failed
                print(f"Steam: logging in failed: {e!r}; trying again in {RETRY} s", flush=True)
                if not told and self.on_down:
                    told = True
                    await self.on_down(
                        f"Collector: logging into Steam failed ({e!r}); trying again every"
                        f" {RETRY} s. A bad token needs a new STEAM_REFRESH_TOKEN"
                        " (tools/steampy_mint.py)."
                    )
            else:
                if self._closing:
                    return
            await self.sleep(RETRY)

    def _on_ready(self, client):
        @client.event
        async def on_ready():
            # steam.py calls this after each reconnect too
            self.logins += 1
            print(f"Steam: logged in (login {self.logins} since the service started)", flush=True)

    async def close(self):
        """Logs off and stops logging in again."""
        self._closing = True
        if self.client is not None:
            with contextlib.suppress(Exception):
                await self.client.close()
        if self._task is not None:
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await asyncio.wait_for(self._task, 30)


@contextlib.asynccontextmanager
async def logged_in(token, **kw):
    """A session for one script's run: logs in on first use, off at the end."""
    session = SteamSession(token, **kw)
    try:
        yield session
    finally:
        await session.close()
