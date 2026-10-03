"""Weekly Fly.io cost estimate for Multiballs, posted to the ops channel.

Run weekly by .github/workflows/bot-cost.yml.

Fly has no billing API, so this prices what is actually provisioned with Fly's published rates
(https://fly.io/docs/about/pricing/) and links the dashboard for the real bill. Bandwidth is
left out: the bot's traffic is a few MB a day. Payment health (billing status, card on file) comes
from Fly's undocumented GraphQL API, which has no bill amounts; if that query breaks, the report
says so and posts the rest.

Usage: python cost_report.py <app>   (posts to OPS_WEBHOOK_URL if set, else prints)
"""

import json
import os
import subprocess
import sys
import urllib.request

MONTH_S = 30 * 24 * 3600
SHARED_CPU_PER_S = 0.00000075  # per shared vCPU-second, iad
RAM_GB_PER_S = 0.00000193  # per GB-second above the RAM included with the CPU, iad
INCLUDED_MB_PER_SHARED_CPU = 256
REGION_MARKUP = {"iad": 1.0, "ord": 1.25}  # compute; other regions: check the pricing page
VOLUME_GB_MONTH = 0.15
SNAPSHOT_GB_MONTH = 0.08
SNAPSHOT_FREE_GB = 10
BUDGET = 5.00
FLY = os.environ.get("FLYCTL", "flyctl")


def fly(*args: str):
    out = subprocess.run(  # noqa: S603 (flyctl, or the FLYCTL we were given)
        [FLY, *args, "--json"], check=True, capture_output=True, text=True
    ).stdout
    return json.loads(out) or []


def payment_line(app: str) -> str:
    """Billing status and card on file, from Fly's undocumented GraphQL API."""
    query = (
        "query($app: String!)"
        " { app(name: $app) { organization { billingStatus isCreditCardSaved } } }"
    )
    try:
        req = urllib.request.Request(
            "https://api.fly.io/graphql",
            json.dumps({"query": query, "variables": {"app": app}}).encode(),
            {"Authorization": auth_header(fly_token()), "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 (a fixed https URL)
            org = json.load(res)["data"]["app"]["organization"]
        status, card = org["billingStatus"], org["isCreditCardSaved"]
    except Exception as e:  # undocumented API: report the gap, never fail the report
        return f"• Payment status unavailable ({type(e).__name__})"
    if status == "CURRENT" and card:
        return "• Payment: billing current, card on file"
    problems = ([f"billing status {status}"] if status != "CURRENT" else []) + (
        [] if card else ["no card on file"]
    )
    return (
        f"• ⚠ Payment: {', '.join(problems)} (without a card Fly stops the machine after 5 minutes)"
    )


def auth_header(token: str) -> str:
    """Deploy tokens carry their own "FlyV1 " scheme; a user token from `flyctl auth token`
    is a bearer."""
    return token if token.startswith("FlyV1 ") else f"Bearer {token}"


def fly_token() -> str:
    token = os.environ.get("FLY_API_TOKEN")
    if token:
        return token
    return subprocess.run(  # noqa: S603 (as in fly())
        [FLY, "auth", "token"], check=True, capture_output=True, text=True
    ).stdout.strip()


def machine_month(m: dict) -> float:
    guest = m["config"]["guest"]
    cpus, mem_mb = guest["cpus"], guest["memory_mb"]
    extra_gb = max(0, mem_mb - cpus * INCLUDED_MB_PER_SHARED_CPU) / 1024
    markup = REGION_MARKUP.get(m["region"], 1.0)
    return (cpus * SHARED_CPU_PER_S + extra_gb * RAM_GB_PER_S) * MONTH_S * markup


def report(app: str) -> str:
    lines, total = [], 0.0
    for m in fly("machines", "list", "-a", app):
        guest = m["config"]["guest"]
        what = (
            f"Machine `{m['id']}` · {guest['cpu_kind']} {guest['cpus']}x {guest['memory_mb']} MB"
            f" · {m['region']} · {m['state']}"
        )
        if m["state"] == "started":
            cost = machine_month(m)
            total += cost
            lines.append(f"• {what} · ~${cost:.2f}/mo")
        else:
            lines.append(f"• {what} · not billed for CPU/RAM while stopped")
        if m["region"] not in REGION_MARKUP:
            lines.append(f"  ⚠ no markup known for {m['region']}; priced at iad rates")
    snapshot_gb = 0.0
    for v in fly("volumes", "list", "-a", app):
        cost = v["size_gb"] * VOLUME_GB_MONTH
        total += cost
        lines.append(f"• Volume `{v['name']}` · {v['size_gb']} GB · ~${cost:.2f}/mo")
        snapshot_gb += (
            sum(s.get("size", 0) for s in fly("volumes", "snapshots", "list", v["id"], "-a", app))
            / 1e9
        )
    snap_cost = max(0.0, snapshot_gb - SNAPSHOT_FREE_GB) * SNAPSHOT_GB_MONTH
    total += snap_cost
    lines.append(
        f"• Snapshots · {snapshot_gb:.2f} GB · ~${snap_cost:.2f}/mo"
        f" (first {SNAPSHOT_FREE_GB} GB free)"
    )
    lines.append(payment_line(app))
    flag = "" if total <= BUDGET else f" ⚠ over the ${BUDGET:.2f} budget"
    return "\n".join(
        [
            f"**Multiballs weekly cost** · ≈ **${total:.2f}/mo**{flag}",
            *lines,
            "Estimate from Fly's published rates. Actual bill: <https://fly.io/dashboard/personal/billing>",
        ]
    )


def main() -> None:
    text = report(sys.argv[1])
    url = os.environ.get("OPS_WEBHOOK_URL")
    if not url:
        print(text)
        return
    if not url.startswith("https://"):
        sys.exit("OPS_WEBHOOK_URL is not an https URL")
    body = json.dumps({"content": text}).encode()
    req = urllib.request.Request(  # noqa: S310 (checked https above)
        url, body, {"Content-Type": "application/json", "User-Agent": "multiballs-cost-report"}
    )
    urllib.request.urlopen(req).close()  # noqa: S310 (checked https above)


if __name__ == "__main__":
    main()
