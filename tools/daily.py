"""
The Daily: the game's one-day challenge on one Workshop Map, with its own Steam board
(CONTEXT.md). The developers' API names each day's board; this module decides which
Dailies a Refresh looks up and reads (plan), and asks the API (look_up).

Dailies are database-only: they get no file under data/, and the collector learns which
ones it already holds from the database (known_dailies).
"""

import asyncio
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

# The first Daily the API knows: 2026-08-13..19 are not found (probe of 2026-10-06).
FIRST_DAILY = date(2026, 8, 20)


@dataclass(frozen=True)
class Daily:
    """One Daily as the API describes it, plus whether the database holds it as final.

    Its window is the API's own: windows ran 00:00 to 00:00 UTC through 2026-09-04,
    2026-09-05 ran 25 hours, and 01:00 to 01:00 since. Nothing here assumes one."""

    date: str  # YYYY-MM-DD, as the API names it
    board: str  # the leaderboard name, exactly as returned
    leaderboard_id: str
    pfid: str
    title: str
    starts_at: datetime
    ends_at: datetime
    final: bool = False


@dataclass(frozen=True)
class DailyRead:
    """What a Refresh read of one Daily's board: its rows (board_rows, names filled in), or
    None when the read failed. An empty read counts as failed too (db_writer)."""

    daily: Daily
    rows: list | None
    read_at: datetime  # when the read was made: one at or after ends_at makes it final
    entry_count: int | None = None  # Steam's count, when it gave one


def plan(known, now, first=FIRST_DAILY):
    """(dates to look up, Dailies to read) for a Refresh at `now`.

    known: {date: Daily} the database holds. Every date from `first` through today (UTC)
    with no final Daily is in play: one the database doesn't hold is looked up (so a date
    the API had no Daily for is asked again next run), and one it holds is read if it
    is due."""
    today = now.astimezone(UTC).date()
    lookups, reads = [], []
    for i in range((today - first).days + 1):
        d = str(first + timedelta(days=i))
        held = known.get(d)
        if held is None:
            lookups.append(d)
        elif due(held, now):
            reads.append(held)
    return lookups, reads


class LookupFailed(Exception):  # noqa: N818 (reads as what happened, like the API's own words)
    """The API could not say whether a date has a Daily. Its message never carries the
    key or the URL, which are both secrets (BALLEST_API_KEY, BALLEST_DAILY_URL)."""


def look_up(url, key, day, *, timeout=30):
    """The Daily the API names for `day` (YYYY-MM-DD), or None when it has none
    (`found: false`). Raises LookupFailed otherwise. `url` is the prefix the date is
    appended to (BALLEST_DAILY_URL). The key goes in the BallestAPIKey header, never in
    the URL."""
    req = urllib.request.Request(  # noqa: S310 (the URL is ours, from a secret)
        url + day,
        headers={"BallestAPIKey": key, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (as above)
            body = json.load(r)
    except urllib.error.HTTPError as e:
        raise LookupFailed(f"{day}: HTTP {e.code}") from None
    except Exception as e:
        # an error's own text can name the host, so only its kind is kept
        raise LookupFailed(f"{day}: {type(e).__name__}") from None
    if not isinstance(body, dict) or not body.get("ok"):
        raise LookupFailed(f"{day}: the API did not answer ok")
    if not body.get("found"):
        return None
    c = body.get("challenge") or {}
    try:
        return Daily(
            date=str(c["date"]),
            board=str(c["leaderboard_name"]),
            leaderboard_id=str(c["leaderboard_id"]),
            pfid=str(c["published_file_id"]),
            title=str(c["level_display_name"]),
            starts_at=_instant(c["starts_at"]),
            ends_at=_instant(c["ends_at"]),
        )
    except (KeyError, TypeError, ValueError) as e:
        raise LookupFailed(f"{day}: the challenge is missing {e}") from None


def _instant(s):
    t = datetime.fromisoformat(s)
    if t.tzinfo is None:
        raise ValueError("a time zone on " + s)
    return t.astimezone(UTC)


def due(d, now):
    """Whether a Daily's board is worth reading at `now`: it has opened and is not final."""
    return not d.final and d.starts_at <= now


# Seconds the Daily step may take. It runs before the Circuit and Workshop files are
# written, so a slow API or a slow board read must not hold them up.
BUDGET = 300.0


async def collect(
    lookups,
    reads,
    now,
    *,
    look_up,
    read,
    budget=BUDGET,
    pace=0.0,
    clock=time.monotonic,
    sleep=asyncio.sleep,
):
    """Read the due Dailies the database holds (`reads`, from plan), then look up each of
    `lookups`, `pace` seconds apart, and read each one found that is due.

    look_up(date) is awaited for a Daily or None, and may raise LookupFailed, which skips
    that date; read(Daily) is awaited for its DailyRead. Once `budget` seconds have passed
    by `clock`, nothing more is looked up or read and a call still going is abandoned: what
    was read by then is handed on, and everything else waits for the next run, as a failed
    lookup does.

    Returns (the DailyReads, the dates with no Daily, whether the budget ran out)."""
    deadline = clock() + budget
    out, missing = [], []

    async def within(aw):
        # wait_for refuses a call with no time left, so the deadline also stops the loop
        return await asyncio.wait_for(aw, max(0.0, deadline - clock()))

    async def read_all(ds):
        for d in sorted(ds, key=lambda d: d.date):
            out.append(await within(read(d)))  # noqa: PERF401 (keeps each read if one times out)

    try:
        await read_all(reads)
        found = []
        for i, d in enumerate(lookups):
            if i and pace:
                await within(sleep(pace))
            try:
                got = await within(look_up(d))
            except LookupFailed as e:
                print(f"  [warn] Daily lookup failed: {e}")
                continue
            if got is None:
                missing.append(d)
            elif due(got, now):
                found.append(got)
        await read_all(found)
    except TimeoutError:
        print(f"  [warn] Daily step stopped at its {budget:g} s budget; the rest waits")
        return out, missing, True
    return out, missing, False
