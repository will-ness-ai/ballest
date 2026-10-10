"""Daily report on the Vercel team's plan and usage, posted to the ops channel.

Run daily by .github/workflows/vercel-usage.yml. It reads the team's plan and billing cycle
(`/v2/teams/<id>`) and its daily usage (`/v2/usage`), and reports three things:

- the plan, whether it is active, and when it renews;
- on Pro, this cycle's CDN requests and data transfer against the Flat Rate CDN tier (a cycle
  over the tier moves the team to the next, paid tier from the next cycle);
- whether the last 30 days would fit Hobby, which on Hobby means whether the site is about to be
  paused (Hobby pauses a project over a limit), and on Pro whether it could go back to Hobby.

It posts on Mondays, and on any day something needs attention: a Hobby limit or the CDN tier
past WARN_AT, or the last full day's pace past either, or a plan that is not active. The limits
are Vercel's published ones, copied by hand: check https://vercel.com/docs/plans/hobby and
https://vercel.com/docs/pricing/flat-rate-cdn if they look wrong. The usage is the whole
team's, which is what the limits count; ballest is almost all of it.

Usage: python vercel_usage.py [--always]
  (posts to OPS_WEBHOOK_URL if set, else prints; --always posts whatever the day or the numbers)
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
USAGE_PAGE = "<https://vercel.com/n3sonlines-projects/~/usage>"  # <> stops Discord's preview
BILLING_PAGE = "<https://vercel.com/n3sonlines-projects/~/settings/billing>"
DAYS = 30
WARN_AT = 0.5
GB = 1e9


class Limit(NamedTuple):
    name: str
    cap: float  # over 30 days
    amount: Callable[[dict], float]  # from one day's totals
    show: Callable[[float], str]


def requests(d: dict) -> float:
    return d["request_hit_count"] + d["request_miss_count"]


def transfer_gb(d: dict) -> float:
    return d["bandwidth_outgoing_bytes"] / GB


def count(n: float) -> str:
    return f"{n:,.0f}"


def tenths(n: float) -> str:
    return f"{n:,.1f}"


HOBBY = [
    Limit("Edge requests", 1_000_000, requests, count),
    Limit(
        "Function invocations",
        1_000_000,
        lambda d: d["function_invocation_successful_count"] + d["function_invocation_error_count"],
        count,
    ),
    Limit(
        "Function memory (GB-hours)",
        360,
        lambda d: (
            d["function_execution_successful_gb_hours"]
            + d["function_execution_error_gb_hours"]
            + d["function_execution_timeout_gb_hours"]
        ),
        tenths,
    ),
    Limit("Data transfer out (GB)", 100, transfer_gb, tenths),
]

# Flat Rate CDN tiers on Pro by monthly price in cents (the team's `flatRateCdnBase` item):
# CDN requests and data transfer (GB) a cycle may use. The included tier costs nothing.
CDN_TIERS = {
    0: (1_000_000, 1_000),
    2000: (10_000_000, 50_000),
    10000: (50_000_000, 50_000),
    30000: (150_000_000, 50_000),
}


class Billing(NamedTuple):
    plan: str  # "hobby" or "pro"
    active: bool
    start: dt.datetime  # this billing cycle
    end: dt.datetime
    cdn: tuple[float, float] | None  # the Flat Rate CDN tier's capacity, None when off


def get(token: str, path: str, **query: str) -> dict:
    url = f"{API}{path}?{urllib.parse.urlencode({'teamId': TEAM, **query})}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})  # noqa: S310 (a fixed https URL)
    with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 (as above)
        return json.load(res)


def billing(token: str) -> Billing:
    """The team's plan and current billing cycle."""
    b = get(token, f"/v2/teams/{TEAM}")["billing"]
    when = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.UTC)  # noqa: E731
    base = b.get("invoiceItems", {}).get("flatRateCdnBase")
    return Billing(
        plan=b["plan"],
        active=b["status"] == "active" and not b.get("cancelation"),
        start=when(b["period"]["start"]),
        end=when(b["period"]["end"]),
        cdn=CDN_TIERS.get(round(base["price"])) if base else None,
    )


def usage_days(token: str, since: dt.datetime, now: dt.datetime) -> list:
    """The team's daily request and function totals from `since` to now, oldest first."""
    iso = "%Y-%m-%dT%H:%M:%S.000Z"
    return get(
        token,
        "/v2/usage",
        type="requests",
        **{"from": since.strftime(iso), "to": now.strftime(iso)},
    )["data"]


class Check(NamedTuple):
    flag: bool  # past WARN_AT of its cap, or on pace to pass the cap
    share: float
    text: str


def check(name: str, show: Callable[[float], str], total: float, pace: float, cap: float, day: str):
    share = total / cap
    flag = share >= WARN_AT or pace >= cap
    return Check(
        flag,
        share,
        f"{'⚠️' if flag else '•'} {name}: {show(total)} of {show(cap)} ({share:.0%})"
        f" · {show(pace)} a month at {day}'s pace",
    )


def report(bill: Billing, days: list, now: dt.datetime) -> tuple[str, bool]:
    """The report's text, and whether anything in it needs attention."""
    # the last full day sets the pace; today's row is still filling
    today = now.strftime("%Y-%m-%d")
    full = [d for d in days if not d["date"].startswith(today)]
    last = full[-1] if full else None
    day = last["date"][:10] if last else "no full day"
    month = days[-DAYS:]
    renews = f"{bill.end:%b} {bill.end.day}"

    # Hobby's limits, over the last 30 days
    hobby = [
        check(
            limit.name,
            limit.show,
            sum(limit.amount(d) for d in month),
            limit.amount(last) * DAYS if last else 0,
            limit.cap,
            day,
        )
        for limit in HOBBY
    ]
    over = [c for c in hobby if c.flag]

    if bill.plan == "hobby":
        head = (
            "**Vercel is nearing a Hobby limit**"
            if over
            else "**Vercel usage is well under the Hobby limits**"
        )
        lines = [
            f"{head} (Hobby, free; last {DAYS} days, whole team)",
            *(c.text for c in hobby),
            f"Hobby pauses a project that goes over: {USAGE_PAGE}",
        ]
        return "\n".join(lines), bool(over)

    # Pro: the plan, this cycle against the Flat Rate CDN tier, and whether Hobby would do
    status = f"renews {renews}" if bill.active else f"not active, ends {renews} ⚠️"
    lines = [f"**Vercel: Pro, {status}** ($20 a month, with $20 of usage credit)"]
    near = not bill.active
    if bill.cdn:
        cycle = [d for d in days if d["date"][:10] >= bill.start.strftime("%Y-%m-%d")]
        length = (bill.end - bill.start).days
        tier = [
            check(
                name,
                show,
                sum(amount(d) for d in cycle),
                amount(last) * length if last else 0,
                cap,
                day,
            )
            for name, amount, cap, show in [
                ("CDN requests", requests, bill.cdn[0], count),
                ("Data transfer (GB)", transfer_gb, bill.cdn[1], tenths),
            ]
        ]
        near = near or any(c.flag for c in tier)
        lines += [
            f"This cycle since {bill.start:%b} {bill.start.day}, against the Flat Rate CDN tier:",
            *(c.text for c in tier),
            "A cycle over its tier moves the team up a tier ($20 a month more) next cycle.",
        ]
    else:
        lines.append("Flat Rate CDN is off, so CDN requests are billed from the $20 credit.")
    if over:
        lines += [f"**Back to Hobby?** Not yet. Last {DAYS} days against Hobby's limits:"]
        lines += [c.text for c in over]
    else:
        lines.append(
            f"**Back to Hobby?** Yes: the last {DAYS} days fit Hobby's limits, so downgrading"
            f" before {renews} saves $20 a month: {BILLING_PAGE}"
        )
    lines.append(f"Usage: {USAGE_PAGE}")
    return "\n".join(lines), near


def main() -> None:
    token = os.environ.get("VERCEL_TOKEN")
    if not token:
        sys.exit("VERCEL_TOKEN is not set")
    now = dt.datetime.now(dt.UTC)
    bill = billing(token)
    since = min(now - dt.timedelta(days=DAYS), bill.start)
    text, near = report(bill, usage_days(token, since, now), now)
    url = os.environ.get("OPS_WEBHOOK_URL")
    monday = now.weekday() == 0
    if not url or not (near or monday or "--always" in sys.argv):
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
