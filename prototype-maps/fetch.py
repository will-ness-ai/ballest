"""PROTOTYPE: download the most-subscribed Workshop Maps' .ballmap files for the grill-design
round. Runs in GitHub Actions (cloud sessions can't reach Steam's content servers)."""

import json
import os
import sys
import urllib.parse
import urllib.request

import steam

APP = 3339810
OUT = os.path.dirname(os.path.abspath(__file__))


def query(query_type, n):
    q = urllib.parse.urlencode(
        {
            "key": os.environ["STEAM_API_KEY"],
            "appid": APP,
            "query_type": query_type,
            "numperpage": n,
            "return_playtime_stats": 1,
            "return_metadata": 1,
        }
    )
    with urllib.request.urlopen(
        "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?" + q, timeout=60
    ) as r:
        return json.load(r)["response"]["publishedfiledetails"]


def catalogue():
    maps, cursor = [], "*"
    while True:
        q = urllib.parse.urlencode(
            {
                "key": os.environ["STEAM_API_KEY"],
                "appid": APP,
                "query_type": 1,
                "numperpage": 100,
                "cursor": cursor,
                "return_playtime_stats": 1,
            }
        )
        with urllib.request.urlopen(
            "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?" + q, timeout=60
        ) as r:
            resp = json.load(r)["response"]
        batch = resp.get("publishedfiledetails") or []
        maps += batch
        nxt = resp.get("next_cursor")
        if not batch or not nxt or nxt == cursor:
            return maps
        cursor = nxt


ranked = query(0, 12)
by_subs = sorted(catalogue(), key=lambda it: -int(it.get("lifetime_subscriptions") or 0))[:15]
picks = {}
for it in ranked + by_subs:
    picks.setdefault(it["publishedfileid"], it)
index = [
    {
        "pfid": p,
        "title": it.get("title"),
        "subs": int(it.get("lifetime_subscriptions") or 0),
        "sessions": int(it.get("lifetime_playtime_sessions") or 0),
        "steam_rank": next((i for i, r in enumerate(ranked) if r["publishedfileid"] == p), None),
        "size": int(it.get("file_size") or 0),
    }
    for p, it in picks.items()
]
print(json.dumps(index, indent=1))


class C(steam.Client):
    async def on_ready(self):
        try:
            print("ready", flush=True)
            for pf in await self.fetch_published_files(*[int(p) for p in picks]):
                m = await pf.manifest()
                for f in m.files:
                    data = await f.read()
                    if not data:
                        continue
                    with open(os.path.join(OUT, f"{pf.id}.ballmap"), "wb") as fh:  # noqa: ASYNC230
                        fh.write(data)
                    print(pf.id, f, len(data), flush=True)
        finally:
            await self.close()


for _attempt in range(4):
    try:
        C().run(refresh_token=os.environ["STEAM_REFRESH_TOKEN"])
    except Exception as e:
        print("run ended:", repr(e)[:200], flush=True)
    if all(os.path.exists(os.path.join(OUT, f"{p}.ballmap")) for p in picks):
        break
    import time

    time.sleep(10)
with open(os.path.join(OUT, "index.json"), "w") as fh:
    json.dump(index, fh, indent=1)
sys.exit(0)
