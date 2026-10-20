"""
The collector's one Steam session (ADR 0014): a single login that every job the service runs
shares, the Refresh, the file downloads and the Daily read alike. A second login on the
account drops the first, so the service never makes one.

It logs in when a job first needs Steam (`ready`, `send`) and stays logged in. steam.py
reconnects a dropped connection by itself; a login that fails outright (a bad token, Steam
down) is tried again every RETRY seconds with a fresh client, and `on_down` hears of it once
until a login works. Leaderboard requests go through `send`, one at a time, since the CM
silently drops replies with several in flight, and so do a file download's requests
(`call`), each with REQUEST_TIMEOUT, so a request lost with its connection fails instead of
hanging its job. While logging in is failing, a job asking for Steam fails at once.

A script run on its own (`python tools/steampy_collect.py`) uses `logged_in`, which logs off
when its one job ends.
"""

import asyncio
import contextlib
import contextvars
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

    def __init__(self, token, *, make_client=None, on_down=None, sleep=asyncio.sleep):
        self.token, self.on_down, self.sleep = token, on_down, sleep
        self.make_client = make_client or steam.Client
        self.client = None
        self.logins = 0
        # why the last login failed, until one works
        self.down = None
        self._task = None
        self._closing = False
        self._one_at_a_time = asyncio.Lock()

    async def ready(self):
        """The logged-in client, logging in first if nothing has yet. Raises ConnectionError
        at once while logging in is failing, and TimeoutError after READY_TIMEOUT; a dropped
        connection's reconnect is waited out the same way."""
        if self._task is None:
            # its own context: what the login prints belongs to no job (runner.JobLog)
            self._task = asyncio.create_task(self._hold(), context=contextvars.Context())
        async with asyncio.timeout(READY_TIMEOUT):
            # polled: a failed login swaps in a fresh client, and none has an event for that
            while not (self.client and self.client.is_ready()):
                if self.down is not None:
                    raise ConnectionError(f"Steam login failing: {self.down!r}")
                await asyncio.sleep(0.2)
        return self.client

    async def call(self, request):
        """`await request(client)` on the logged-in client, after any request ahead of it
        has its reply, within REQUEST_TIMEOUT: every request to the CM goes through here, a
        leaderboard read's or a file download's alike."""
        client = await self.ready()
        async with self._one_at_a_time, asyncio.timeout(REQUEST_TIMEOUT):
            return await request(client)

    async def send(self, msg):
        """Sends one raw protobuf request and returns its reply (steampy_common's leaderboard
        requests)."""
        return await self.call(
            lambda client: client._state.ws.send_proto_and_wait(msg)  # noqa: SLF001 (steam.py has no public raw-protobuf call)
        )

    async def _hold(self):
        while not self._closing:
            client = self.client = self.make_client()
            self._on_ready(client)
            try:
                async with client:
                    await client.login(refresh_token=self.token)
            except Exception as e:
                if self._closing:
                    return  # steam.py often raises on the teardown after close()
                print(f"Steam: logging in failed: {e!r}; trying again in {RETRY} s", flush=True)
                was_down, self.down = self.down, e
                if was_down is None and self.on_down:
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
            self.down = None
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
