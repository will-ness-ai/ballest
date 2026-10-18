"""A maker's Workshop Maps, or a list or collection of them, for adding a Campaign.

    python tools/workshop_maps.py [--json] <query ...>

The query is Workshop items (their links or IDs, or a whole pasted post holding them): a
Map stands for itself and a Steam collection for its Maps in the collection's order, in the
order given. Or it names a maker: a profile URL (/profiles/ or /id/), a SteamID64, or any
part of their in-game or Steam name in any case (their Maps oldest first). Prints each Map's ID,
date, title and maker, marks the ones already in a Campaign (web/lib/campaigns.ts) and the
ones the site doesn't list yet (a Refresh lists them), and ends with the `maps:` line to
paste. --json prints the same as one JSON object for `pnpm --silent campaign draft`
(web/scripts/campaign.ts), with errors as {"error": ...}. Needs STEAM_API_KEY (env or .env),
as the collector does; docs/site.md, "Campaigns", covers adding one.
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from campaign_common import load_key, resolve_names, workshop_catalogue

CAMPAIGNS_TS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "lib", "campaigns.ts"
)
API = "https://api.steampowered.com/"
MAP_URL_BASE = "https://ballestrecords.com/map/"


# a Workshop link's ID (wherever it sits among the link's parameters), or a bare one
ITEM = re.compile(r"filedetails/\?(?:[^\s#]*?&)?id=(\d+)|(?<![\w/=?&])(\d{6,11})(?!\w)")


def parse_query(text):
    """What the command line names: ("items", Workshop IDs in the order given),
    ("player", SteamID64), ("vanity", a custom URL's name) or ("name", text)."""
    text = text.strip()
    if len(text) == 17 and text.isdigit() and text.startswith("7656"):
        return ("player", text)
    ids = [link or bare for link, bare in ITEM.findall(text)]
    if ids:
        return ("items", ids)
    player = re.search(r"/profiles/(\d+)", text)
    if player:
        return ("player", player.group(1))
    vanity = re.search(r"steamcommunity\.com/id/([^/?#\s]+)", text)
    if vanity:
        return ("vanity", vanity.group(1))
    return ("name", text)


def match(maps, query, personas=None):
    """The Maps a query names: ("items", IDs) in that order, a maker's oldest first.
    A name matches the in-game name, or the Steam name in `personas` (cid -> name)."""
    kind, value = query
    if kind == "items":
        by_id = {m["pfid"]: m for m in maps}
        return [by_id[i] for i in value if i in by_id]
    if kind == "player":
        found = [m for m in maps if m["cid"] == value]
    else:
        needle = value.casefold()
        names = personas or {}
        found = [
            m
            for m in maps
            if needle in m["creator"].casefold() or needle in names.get(m["cid"], "").casefold()
        ]
    return sorted(found, key=lambda m: m["created"])


def campaign_line(maps):
    return "maps: [" + ", ".join(f'"{m["pfid"]}"' for m in maps) + "],"


def curated_ids(source):
    """The Workshop IDs campaigns.ts lists (ten digits, where a SteamID64 has 17)."""
    return set(re.findall(r'"(\d{9,11})"', source))


def expand(item_id):
    """A collection's items in its own order, or [item_id] for anything else (a Map).
    GetCollectionDetails needs no key."""
    body = urllib.parse.urlencode({"collectioncount": 1, "publishedfileids[0]": item_id})
    with urllib.request.urlopen(  # noqa: S310 (a fixed https URL)
        API + "ISteamRemoteStorage/GetCollectionDetails/v1/", body.encode(), timeout=30
    ) as r:
        details = json.load(r)["response"]["collectiondetails"][0]
    children = sorted(details.get("children") or [], key=lambda c: c.get("sortorder", 0))
    return [c["publishedfileid"] for c in children] or [item_id]


def listed_on_site(html):
    """Whether a site Map page shows the Map. One the collector hasn't listed yet is a soft
    not-found that still answers 200, told apart only by its noindex (generateMetadata in
    web/app/map/[pfid]/[[...focus]]/page.tsx)."""
    return not re.search(r'<meta(?=[^>]*name="robots")[^>]*noindex', html)


def on_site(pfid):
    """listed_on_site for one Map, or None when the site can't be read."""
    try:
        url = MAP_URL_BASE + pfid
        with urllib.request.urlopen(url, timeout=30) as r:  # noqa: S310 (our site, a numeric ID)
            return listed_on_site(r.read().decode("utf-8", "replace"))
    except OSError:
        return None


def report(found, site, missing):
    """What --json prints: each Map with whether the site lists it (None when the site
    couldn't be read), and the IDs that found no Map. The campaign tool reads which Campaign
    has a Map from campaigns.ts itself."""
    keys = ("pfid", "title", "creator", "cid", "created")
    maps = [
        {**{k: m[k] for k in keys}, "on_site": shown} for m, shown in zip(found, site, strict=True)
    ]
    return {"maps": maps, "missing": missing}


class QueryError(Exception):
    """A query that finds nothing to show, in words."""


def resolve_vanity(key, name):
    q = urllib.parse.urlencode({"key": key, "vanityurl": name})
    url = API + "ISteamUser/ResolveVanityURL/v1/?" + q
    with urllib.request.urlopen(url, timeout=30) as r:  # noqa: S310 (a fixed https URL)
        resp = json.load(r)["response"]
    if resp.get("success") != 1:
        raise QueryError(f"no Steam profile at /id/{name}")
    return resp["steamid"]


def find(query):
    """The Maps a query names, the IDs that found none, the curated IDs and which Maps
    the site lists; QueryError when there is nothing to show."""
    kind, value = parse_query(query)
    key = load_key()
    if not key:
        raise QueryError("no STEAM_API_KEY (env or .env)")
    maps = workshop_catalogue(key)
    personas = None
    if kind == "items":
        # a collection's Maps in its order, and a Map listed twice only once
        value = list(dict.fromkeys(i for item in value for i in expand(item)))
    elif kind == "vanity":
        kind, value = "player", resolve_vanity(key, value)
    elif kind == "name":
        summaries = resolve_names(key, sorted({m["cid"] for m in maps if m["cid"]}))
        personas = {cid: p["persona"] for cid, p in summaries.items()}
    found = match(maps, (kind, value), personas)
    listed = {m["pfid"] for m in found}
    missing = [i for i in value if i not in listed] if kind == "items" else []
    if not found:
        raise QueryError("no Maps found" + (f" for {', '.join(missing)}" if missing else ""))
    with open(CAMPAIGNS_TS, encoding="utf-8") as f:
        curated = curated_ids(f.read())
    with ThreadPoolExecutor(8) as pool:
        site = list(pool.map(on_site, [m["pfid"] for m in found]))
    return found, missing, curated, site


def main():
    args = sys.argv[1:]
    as_json = args[:1] == ["--json"]
    if as_json:
        args = args[1:]
    if not args:
        sys.exit(__doc__)
    try:
        found, missing, curated, site = find(" ".join(args))
    except (QueryError, OSError) as e:
        message = f"couldn't reach Steam: {e}" if isinstance(e, OSError) else str(e)
        if as_json:
            print(json.dumps({"error": message}))
            sys.exit(1)
        sys.exit(message)
    if as_json:
        print(json.dumps(report(found, site, missing)))
        return
    if missing:
        print(
            "not this game's Maps, not public, or newer than Steam's catalogue: "
            + ", ".join(missing)
        )
    for m, shown in zip(found, site, strict=True):
        day = time.strftime("%Y-%m-%d", time.gmtime(m["created"]))
        mark = "  (in a Campaign)" if m["pfid"] in curated else ""
        if shown is False:
            mark += "  (not on the site yet)"
        print(f"{m['pfid']}  {day}  {m['title']}  by {m['creator']} ({m['cid']}){mark}")
    if False in site:
        print(
            "the site lists a Map from the Refresh after it is published: run one before checking"
        )
    if None in site:
        print("couldn't reach the site to check which Maps it lists")
    print(campaign_line(found))


if __name__ == "__main__":
    main()
