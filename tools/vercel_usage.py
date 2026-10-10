"""Daily check of the Vercel team's usage against the Hobby limits, posted to the ops channel.

Run daily by .github/workflows/vercel-usage.yml. It reads Vercel's usage API (`/v2/usage`, the
team's daily totals) for the last 30 days and warns when a total passes WARN_AT of its limit, or
when the last full day's pace would pass the limit over 30 days. On Hobby a project that goes over
is paused, so the warning comes while there is still time to act (robots.txt, the firewall, or
Pro). The limits are Vercel's published Hobby limits, copied by hand: check
https://vercel.com/docs/plans/hobby if they look wrong. The usage is the whole team's, which is
what the limits count; ballest is almost all of it.

Usage: python vercel_usage.py [--always]
  (posts to OPS_WEBHOOK_URL if set, else prints; --always posts even when nothing is near a limit)
"""

import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import NamedTuple

API = "https://api.vercel.com"
TEAM = "team_OvQ9vq2bBFHLchpIqOs2FCZn"  # n3sonline's projects
DAYS = 30
WARN_AT = 0.5
GB = 1e9


class Limit(NamedTuple):
    name: str
    cap: float  # over 30 days
    amount: Callable[[dict], float]  # from one day's totals
    show: Callable[[float], str]


LIMITS = [
    Limit(
        "Edge requests",
        1_000_000,
        lambda d: d["request_hit_count"] + d["request_miss_count"],
        lambda n: f"{n:,.0f}",
    ),
    Limit(
        "Function invocations",
        1_000_000,
        lambda d: d["function_invocation_successful_count"] + d["function_invocation_error_count"],
        lambda n: f"{n:,.0f}",
    ),
    Limit(
        "Function memory (GB-hours)",
        360,
        lambda d: (
            d["function_execution_successful_gb_hours"]
            + d["function_execution_error_gb_hours"]
            + d["function_execution_timeout_gb_hours"]
        ),
        lambda n: f"{n:,.1f}",
    ),
    Limit(
        "Data transfer out (GB)",
        100,
        lambda d: d["bandwidth_outgoing_bytes"] / GB,
        lambda n: f"{n:,.1f}",
    ),
]


def usage_days(token: str, now: dt.datetime) -> list:
    """The team's daily request and function totals for the last DAYS days, oldest first."""
    since = now - dt.timedelta(days=DAYS)
    query = urllib.parse.urlencode(
        {
            "teamId": TEAM,
            "type": "requests",
            "from": since.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "to": now.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        }
    )
    req = urllib.request.Request(  # noqa: S310 (a fixed https URL)
        f"{API}/v2/usage?{query}", headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 (as above)
        return json.load(res)["data"]


def report(days: list, now: dt.datetime) -> tuple[str, bool]:
    """The report's text, and whether anything is near its limit."""
    # the last full day sets the pace; today's row is still filling
    today = now.strftime("%Y-%m-%d")
    full = [d for d in days if not d["date"].startswith(today)]
    last = full[-1] if full else None
    lines, near = [], False
    for limit in LIMITS:
        total = sum(limit.amount(d) for d in days)
        pace = limit.amount(last) * DAYS if last else 0
        share = total / limit.cap
        flag = share >= WARN_AT or pace >= limit.cap
        near = near or flag
        lines.append(
            f"{'⚠️' if flag else '•'} {limit.name}: {limit.show(total)} of {limit.show(limit.cap)}"
            f" ({share:.0%}) · {limit.show(pace)} a month at"
            f" {last['date'][:10] if last else 'no full day'}'s pace"
        )
    head = (
        "**Vercel is nearing a Hobby limit**"
        if near
        else "**Vercel usage is well under the Hobby limits**"
    )
    return "\n".join(
        [
            f"{head} (last {DAYS} days, whole team)",
            *lines,
            "Hobby pauses a project that goes over: <https://vercel.com/n3sonlines-projects/~/usage>",
        ]
    ), near


def main() -> None:
    token = os.environ.get("VERCEL_TOKEN")
    if not token:
        sys.exit("VERCEL_TOKEN is not set")
    now = dt.datetime.now(dt.UTC)
    text, near = report(usage_days(token, now), now)
    url = os.environ.get("OPS_WEBHOOK_URL")
    if not url or not (near or "--always" in sys.argv):
        print(text)
        return
    if not url.startswith("https://"):
        sys.exit("OPS_WEBHOOK_URL is not an https URL")
    body = json.dumps({"content": text}).encode()
    req = urllib.request.Request(  # noqa: S310 (checked https above)
        url, body, {"Content-Type": "application/json", "User-Agent": "ballest-vercel-usage"}
    )
    urllib.request.urlopen(req, timeout=30).close()  # noqa: S310 (checked https above)


if __name__ == "__main__":
    main()
