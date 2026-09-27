"""Weekly Fly.io cost estimate for Multiballs, posted to the ops channel (.github/workflows/bot-cost.yml).

Fly has no billing API, so this prices what is actually provisioned with Fly's published rates
(https://fly.io/docs/about/pricing/) and links the dashboard for the real bill. Bandwidth is
left out: the bot's traffic is a few MB a day.

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
    out = subprocess.run([FLY, *args, "--json"], check=True, capture_output=True, text=True).stdout
    return json.loads(out) or []


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
        what = f"Machine `{m['id']}` · {guest['cpu_kind']} {guest['cpus']}x {guest['memory_mb']} MB · {m['region']} · {m['state']}"
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
        snapshot_gb += sum(s.get("size", 0) for s in fly("volumes", "snapshots", "list", v["id"], "-a", app)) / 1e9
    snap_cost = max(0.0, snapshot_gb - SNAPSHOT_FREE_GB) * SNAPSHOT_GB_MONTH
    total += snap_cost
    lines.append(f"• Snapshots · {snapshot_gb:.2f} GB · ~${snap_cost:.2f}/mo (first {SNAPSHOT_FREE_GB} GB free)")
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
    body = json.dumps({"content": text}).encode()
    req = urllib.request.Request(url, body, {"Content-Type": "application/json", "User-Agent": "multiballs-cost-report"})
    urllib.request.urlopen(req).close()


if __name__ == "__main__":
    main()
