"""A maker's Workshop Maps, or a Steam collection's, for adding a Campaign.

    python tools/workshop_maps.py <query>

The query is a collection (its URL or ID: its Maps in the collection's order), a player
(a profile URL or SteamID64), or a name: a maker's in-game name, any part of it in any
case, or part of a Workshop title (Maps oldest first). Prints each Map's ID, date, title
and maker, marks the ones already in a Campaign (web/lib/campaigns.ts), and ends with the
`maps:` line to paste into a new Campaign. Needs STEAM_API_KEY (env or .env), as the
collector does; docs/site.md, "Campaigns", covers adding one.
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from campaign_common import load_key, workshop_catalogue

CAMPAIGNS_TS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "lib", "campaigns.ts"
)


def parse_query(text):
    """("collection", id), ("player", SteamID64) or ("name", text)."""
    collection = re.search(r"filedetails/\?id=(\d+)", text)
    if collection:
        return ("collection", collection.group(1))
    player = re.search(r"/profiles/(\d+)", text)
    if player:
        return ("player", player.group(1))
    if text.isdigit():
        return (
            ("player", text)
            if len(text) == 17 and text.startswith("7656")
            else ("collection", text)
        )
    return ("name", text)


def match(maps, query, children=None):
    """The Maps a query names: a collection's in its order, anyone else's oldest first."""
    kind, value = query
    if kind == "collection":
        by_id = {m["pfid"]: m for m in maps}
        return [by_id[c] for c in children or [] if c in by_id]
    if kind == "player":
        found = [m for m in maps if m["cid"] == value]
    else:
        needle = value.casefold()
        found = [
            m for m in maps if needle in m["creator"].casefold() or needle in m["title"].casefold()
        ]
    return sorted(found, key=lambda m: m["created"])


def campaign_line(maps):
    return "maps: [" + ", ".join(f'"{m["pfid"]}"' for m in maps) + "],"


def curated_ids(source):
    """The Workshop IDs campaigns.ts lists (ten digits, where a SteamID64 has 17)."""
    return set(re.findall(r'"(\d{9,11})"', source))


def collection_children(collection_id):
    """A collection's items in its own order (GetCollectionDetails needs no key)."""
    body = urllib.parse.urlencode(
        {"collectioncount": 1, "publishedfileids[0]": collection_id}
    ).encode()
    with urllib.request.urlopen(
        "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/",
        body,
        timeout=30,
    ) as r:
        details = json.load(r)["response"]["collectiondetails"][0]
    children = sorted(details.get("children", []), key=lambda c: c.get("sortorder", 0))
    return [c["publishedfileid"] for c in children]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    key = load_key()
    if not key:
        sys.exit("no STEAM_API_KEY (env or .env)")
    query = parse_query(sys.argv[1])
    children = collection_children(query[1]) if query[0] == "collection" else None
    found = match(workshop_catalogue(key), query, children)
    if children is not None and len(found) < len(children):
        missing = [c for c in children if c not in {m["pfid"] for m in found}]
        print(f"not Maps of this game (or not public): {', '.join(missing)}")
    if not found:
        sys.exit("no Maps found")
    with open(CAMPAIGNS_TS, encoding="utf-8") as f:
        curated = curated_ids(f.read())
    for m in found:
        day = time.strftime("%Y-%m-%d", time.gmtime(m["created"]))
        mark = "  (in a Campaign)" if m["pfid"] in curated else ""
        print(f"{m['pfid']}  {day}  {m['title']}  by {m['creator']} ({m['cid']}){mark}")
    print(campaign_line(found))


if __name__ == "__main__":
    main()
