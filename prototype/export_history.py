"""Prototype data: replay data/'s git history the way db_backfill + db_writer do, in memory,
and write each board's Score history in reads.ts's HistoryEntry shape.

  python prototype/export_history.py   -> scratch/history/<board>.json, players.json, refreshes.json
"""

import json
import os
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.modules.setdefault("psycopg", types.ModuleType("psycopg"))  # backfill imports it; unused here
import db_backfill as bf  # noqa: E402

OUT = os.path.join(ROOT, "scratch", "history")
os.makedirs(OUT, exist_ok=True)

snaps = bf.commits()
print(f"{len(snaps)} snapshots")
blobs, cache, prev = bf.Blobs(), {}, {}
refreshes = []  # iso time per refresh index
entries = {}  # board -> list of dicts
open_ = {}  # (board, sid) -> entry dict
persona = {}
points_boards = set()
meta = {}  # board -> {display, group, kind}
try:
    for i, (sha, when) in enumerate(snaps):
        files = bf.tree(sha)
        boards, workshop = bf.snapshot(files, prev, blobs, cache)
        prev = files
        t = when.astimezone().isoformat()
        refreshes.append({"at": t, "sha": sha[:9]})
        read = []
        for b in boards:
            if b["name"] in ("Map_S1_Current", "Overall_AllSeasons") or b["name"].startswith("Derived"):
                continue
            meta[b["name"]] = {"group": b["group"], "kind": "overall" if b["name"].startswith("Overall") else "track"}
            if b["name"].startswith("Overall"):
                points_boards.add(b["name"])
            read.append((b["name"], b["rows"]))
        if workshop:
            listed = {m["pfid"]: m for m in workshop["maps"]}
            for m in workshop["maps"]:
                meta[m["name"]] = {"group": None, "kind": "map", "display": m["display"], "pfid": m["pfid"],
                                   "creator": m.get("creator"), "medals": m.get("medals"), "created": m.get("created")}
            for pfid, rows in workshop["boards"].items():
                read.append((listed[pfid]["name"], rows))
        for name, rows in read:
            if not rows:
                continue  # empty read is a failed read
            seen = {}
            for r in rows:
                sid = r["steam_id"]
                if r.get("persona"):
                    persona[sid] = r["persona"]
                seen.setdefault(sid, (int(r["score_ms"]), None if r.get("ugc_id") in ("", "0", None) else r["ugc_id"]))
            # points boards: update in place
            for (bname, sid), e in list(open_.items()):
                if bname != name:
                    continue
                if sid in seen and name in points_boards and e["score"] != seen[sid][0]:
                    e["score"], e["ugcId"] = seen[sid]
                if sid not in seen or seen[sid][0] != e["score"]:
                    e["closedAt"] = t
                    del open_[(bname, sid)]
                else:
                    e["lastSeenAt"] = t
            for sid, (score, ugc) in seen.items():
                if (name, sid) not in open_:
                    e = {"steamId": sid, "score": score, "ugcId": ugc, "firstSeenAt": t, "lastSeenAt": t, "closedAt": None}
                    open_[(name, sid)] = e
                    entries.setdefault(name, []).append(e)
        if i % 20 == 0:
            print(f"  {i}/{len(snaps)} {t}")
finally:
    blobs.close()

for name, es in entries.items():
    for e in es:
        e["persona"] = persona.get(e["steamId"], "")
    with open(os.path.join(OUT, f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump({"name": name, **meta.get(name, {}), "scoresPoints": name in points_boards, "entries": es}, f)
with open(os.path.join(OUT, "_index.json"), "w", encoding="utf-8") as f:
    json.dump({"refreshes": refreshes, "boards": {n: {**meta.get(n, {}), "entries": len(es)} for n, es in entries.items()}}, f)
print(f"wrote {len(entries)} boards, {sum(len(v) for v in entries.values())} entries to {OUT}")
