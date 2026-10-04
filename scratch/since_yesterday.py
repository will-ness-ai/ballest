"""PROTOTYPE: "since yesterday" between two data/ snapshots in git (the real one reads the DB).

python scratch/since_yesterday.py <old commit> <new commit> > scratch/since.json
"""

import json
import subprocess
import sys

sys.path.insert(0, "tools")
import campaign_common as cc

old, new = sys.argv[1], sys.argv[2]


def show(rev, path):
    try:
        out = subprocess.run(
            ["git", "show", f"{rev}:{path}"], capture_output=True, check=True
        ).stdout
        return json.loads(out)
    except subprocess.CalledProcessError:
        return None


def counted(rows, creator=None, author=None):
    """Rows that count, in rank order (creator rule as in ugc_discord_leaderboard.collect)."""
    out = []
    for r in rows:
        if creator and r["steam_id"] == creator:
            if r["score_ms"] > int(author * cc.SCORE_TICKS_PER_SECOND) - cc.CREATOR_BEAT_MARGIN_TICKS:
                continue
        out.append(r)
    return out


cat_old = {m["pfid"]: m for m in show(old, "data/workshop.json")["maps"]}
cat_new = {m["pfid"]: m for m in show(new, "data/workshop.json")["maps"]}

records, beaten, claimed = [], [], []
for pfid, m in cat_new.items():
    if pfid not in cat_old:
        continue
    a, b = show(old, f"data/{m['file']}"), show(new, f"data/{m['file']}")
    if not a or not b:
        continue
    author = m["medals"][3]
    ra, rb = counted(a["rows"], m["cid"], author), counted(b["rows"], m["cid"], author)
    link = {"pfid": pfid, "title": m["display"]}
    if rb and (not ra or ra[0]["steam_id"] != rb[0]["steam_id"]) and ra:
        records.append(
            {
                "map": link,
                "new": rb[0]["persona"],
                "old": ra[0]["persona"],
                "score": rb[0]["score_ms"],
                "old_score": ra[0]["score_ms"],
            }
        )
    if rb and not ra:
        beaten.append({"map": link, "by": rb[0]["persona"], "score": rb[0]["score_ms"]})
    at = int(author * cc.SCORE_TICKS_PER_SECOND)
    if ra and rb and not any(r["score_ms"] <= at for r in ra) and any(r["score_ms"] <= at for r in rb):
        claimed.append({"map": link, "by": next(r["persona"] for r in rb if r["score_ms"] <= at)})

campaign = []
for name in cc.S1_TRACKS + cc.S2_TRACKS:
    a, b = show(old, f"data/boards/{name}.json"), show(new, f"data/boards/{name}.json")
    if a and b and a["rows"] and b["rows"] and a["rows"][0]["steam_id"] != b["rows"][0]["steam_id"]:
        season = dict(cc.BOARDS)[name].split()[-1]
        campaign.append(
            {
                "track": f"S{season} {cc.display_name(name)}",
                "new": b["rows"][0]["persona"],
                "old": a["rows"][0]["persona"],
                "score": b["rows"][0]["score_ms"],
                "old_score": a["rows"][0]["score_ms"],
            }
        )

json.dump(
    {
        "new_maps": len(set(cat_new) - set(cat_old)),
        "campaign_records": campaign,
        "workshop_records": records,
        "newly_beaten": beaten,
        "medals_claimed": claimed,
    },
    open(sys.argv[3], "w", encoding="utf-8"),
    ensure_ascii=False,
    indent=1,
)
