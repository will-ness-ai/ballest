"""Daily report on the Vercel team's plan and usage, posted to the ops channel.

Run daily by .github/workflows/vercel-usage.yml. It reads the team's plan and billing cycle
(`/v2/teams/<id>`) and its daily usage (`/v2/usage`), and reports three things:

- the plan, whether it is active, and when it renews;
- on Pro, this cycle's CDN requests and data transfer against the Flat Rate CDN tier (a cycle
  over the tier moves the team to the next, dearer tier from the next cycle);
- whether the last 30 days would fit Hobby, which on Hobby means whether the site is about to be
  paused (Hobby pauses a project over a limit), and on Pro whether it could go back to Hobby.

A limit "needs attention" past WARN_AT of its cap, or when the last full day's pace would pass
the cap: on Hobby that is the margin before a pause, and on Pro the margin a downgrade wants. It
posts on Mondays, so the plan and the downgrade verdict come round weekly, and on any day
something needs attention. The limits are Vercel's published ones, copied by hand: check
https://vercel.com/docs/plans/hobby and https://vercel.com/docs/pricing/flat-rate-cdn if they
look wrong. Hobby's Active CPU (4 hours) and Fast Origin Transfer (10 GB) are not in the usage
this reads, so the report can't check them. The usage is the whole team's, which is what the
limits count; ballest is almost all of it.

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
PRO_DOLLARS = 20  # a month, which is also its usage credit
DAYS = 30
WARN_AT = 0.5
GB = 1e9


class Limit(NamedTuple):
    name: str
    cap: float  # over its window: 30 days for Hobby, the billing cycle for the CDN tier
    amount: Callable[[dict], float]  # from one day's totals
    show: Callable[[float], str]


class Check(NamedTuple):
    flag: bool  # needs attention
    text: str


def requests(d: dict) -> float:
    return d["request_hit_count"] + d["request_miss_count"]


def transfer_gb(d: dict) -> float:
    return d["bandwidth_outgoing_bytes"] / GB


def count(n: float) -> str:
    return f"{n:,.0f}"


def tenths(n: float) -> str:
    return f"{n:,.1f}"


def date(t: dt.datetime) -> str:
    return f"{t:%b} {t.day}"


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


class Tier(NamedTuple):
    requests: float  # CDN requests a cycle
    gb: float  # data transfer a cycle


# Flat Rate CDN tiers on Pro, by monthly price in cents (the team's `flatRateCdnBase` item), in
# order. The included tier costs nothing.
CDN_TIERS = {
    0: Tier(1_000_000, 1_000),
    2000: Tier(10_000_000, 50_000),
    10000: Tier(50_000_000, 50_000),
    30000: Tier(150_000_000, 50_000),
}


class Billing(NamedTuple):
    plan: str  # "hobby" or "pro"
    active: bool
    start: dt.datetime | None  # this billing cycle, when the plan has one
    end: dt.datetime | None
    cdn: int | None  # the Flat Rate CDN tier's price in cents, None when it is off


def get(token: str, path: str, **query: str) -> dict:
    url = f"{API}{path}?{urllib.parse.urlencode({'teamId': TEAM, **query})}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})  # noqa: S310 (a fixed https URL)
    with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 (as above)
        return json.load(res)


def moment(ms: float | None) -> dt.datetime | None:
    return dt.datetime.fromtimestamp(ms / 1000, dt.UTC) if ms else None


def billing(token: str) -> Billing:
    """The team's plan and current billing cycle."""
    b = get(token, f"/v2/teams/{TEAM}")["billing"]
    period = b.get("period") or {}
    base = (b.get("invoiceItems") or {}).get("flatRateCdnBase")
    return Billing(
        plan=b["plan"],
        active=b.get("status", "active") == "active" and not b.get("cancelation"),
        start=moment(period.get("start")),
        end=moment(period.get("end")),
        cdn=round(base["price"]) if base else None,
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


def check(limit: Limit, days: list, last: dict | None, pace_days: int) -> Check:
    """`limit` over `days`, and the pace of `last` (the last full day) over `pace_days`."""
    total = sum(limit.amount(d) for d in days)
    pace = limit.amount(last) * pace_days if last else 0
    share = total / limit.cap
    flag = share >= WARN_AT or pace >= limit.cap
    day = f"{last['date'][:10]}'s" if last else "no full day's"
    return Check(
        flag,
        f"{'⚠️' if flag else '•'} {limit.name}: {limit.show(total)} of {limit.show(limit.cap)}"
        f" ({share:.0%}) · {limit.show(pace)} a month at {day} pace",
    )


def since_day(days: list, t: dt.datetime) -> list:
    """The days from `t`'s date on (the rows are dated at UTC midnight)."""
    return [d for d in days if d["date"][:10] >= t.strftime("%Y-%m-%d")]


def cdn_tier(bill: Billing, days: list, last: dict | None) -> tuple[list[str], bool]:
    """Pro's lines on this cycle against the Flat Rate CDN tier, and whether they need attention."""
    tier = CDN_TIERS.get(bill.cdn) if bill.cdn is not None else None
    if bill.cdn is None:
        return [
            f"Flat Rate CDN is off, so CDN requests are billed from the ${PRO_DOLLARS} credit."
        ], False
    if tier is None or not (bill.start and bill.end):
        return [
            f"⚠️ The Flat Rate CDN tier at ${bill.cdn / 100:.0f} a month isn't in CDN_TIERS."
        ], True
    prices = list(CDN_TIERS)
    step = prices.index(bill.cdn) + 1
    if step < len(prices):
        more = (prices[step] - bill.cdn) / 100
        up = f"to the {count(CDN_TIERS[prices[step]].requests)} tier (${more:.0f} a month more)"
    else:
        up = "to on-demand pricing"
    length = (bill.end - bill.start).days
    cycle = since_day(days, bill.start)
    checks = [
        check(Limit("CDN requests", tier.requests, requests, count), cycle, last, length),
        check(Limit("Data transfer (GB)", tier.gb, transfer_gb, tenths), cycle, last, length),
    ]
    lines = [
        f"This cycle since {date(bill.start)}, against the Flat Rate CDN tier:",
        *(c.text for c in checks),
        f"A cycle over its tier moves the team {up} from the next cycle.",
    ]
    return lines, any(c.flag for c in checks)


def report(bill: Billing, days: list, now: dt.datetime) -> tuple[str, bool]:
    """The report's text, and whether anything in it needs attention."""
    # the last full day sets the pace; today's row is still filling
    full = [d for d in days if not d["date"].startswith(now.strftime("%Y-%m-%d"))]
    last = full[-1] if full else None
    hobby = [
        check(limit, since_day(days, now - dt.timedelta(days=DAYS)), last, DAYS) for limit in HOBBY
    ]
    over = [c for c in hobby if c.flag]
    ends = f", ends {date(bill.end)}" if bill.end else ""
    inactive = [] if bill.active else [f"⚠️ The plan is not active{ends}."]

    if bill.plan == "hobby":
        head = (
            "**Vercel is nearing a Hobby limit**"
            if over
            else "**Vercel usage is well under the Hobby limits**"
        )
        lines = [
            f"{head} (Hobby, free; last {DAYS} days, whole team)",
            *inactive,
            *(c.text for c in hobby),
            f"Hobby pauses a project that goes over: {USAGE_PAGE}",
        ]
        return "\n".join(lines), bool(over or inactive)

    # Pro: the plan, this cycle against the Flat Rate CDN tier, and whether Hobby would do
    renews = f", renews {date(bill.end)}" if bill.active and bill.end else ""
    lines = [
        f"**Vercel: Pro{renews}** (${PRO_DOLLARS} a month, with ${PRO_DOLLARS} of usage credit)",
        *inactive,
    ]
    near = bool(inactive)
    tier, tier_near = cdn_tier(bill, days, last)
    lines += tier
    near = near or tier_near
    if over:
        lines.append(
            f"**Back to Hobby?** Not yet; each limit should be under half for {DAYS} days:"
        )
        lines += [c.text for c in over]
    else:
        before = f" before {date(bill.end)}" if bill.end else ""
        lines.append(
            f"**Back to Hobby?** Yes: the last {DAYS} days are under half of each Hobby limit"
            f" this checks (not Active CPU or origin transfer), so downgrading{before} saves"
            f" ${PRO_DOLLARS} a month: {BILLING_PAGE}"
        )
    lines.append(f"Usage: {USAGE_PAGE}")
    return "\n".join(lines), near


def main() -> None:
    token = os.environ.get("VERCEL_TOKEN")
    if not token:
        sys.exit("VERCEL_TOKEN is not set")
    now = dt.datetime.now(dt.UTC)
    bill = billing(token)
    since = min(now - dt.timedelta(days=DAYS), bill.start or now)
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
