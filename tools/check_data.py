"""
Offline check of the committed data against the collector's own rules.

Needs no Steam credentials: it reads data/ as committed and rebuilds what the
collector derives, so a change to campaign_common.py can be verified without a
live run. Exit status is non-zero on any failure, so it can gate a commit.

  python tools/check_data.py

Checks:
  - every board in BOARDS has a file, index.json lists it, and the two agree
  - no board is empty, and rows are index-aligned to rank (rows[i].rank == i+1)
  - every file derive() produces from the committed boards — podiums.json and
    players/<shard>.json — matches the committed copy
  - the composite board file equals the one derive() appends, and index.json
    lists it
"""
import os, sys, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    problems = []
    index = load(cc.INDEX_PATH)
    listed = {b["name"]: b for b in index["boards"]}
    boards_out = []
    for name, group in cc.BOARDS:
        path = os.path.join(cc.BOARDS_DIR, name + ".json")
        if not os.path.exists(path):
            problems.append(f"{name}: no board file")
            continue
        board = load(path)
        rows = board.get("rows") or []
        if not rows:
            problems.append(f"{name}: empty board")
        for i, r in enumerate(rows):
            if r.get("rank") != i + 1:
                problems.append(f"{name}: rows[{i}].rank is {r.get('rank')}, rows are not rank-aligned")
                break
        entry = listed.get(name)
        if not entry:
            problems.append(f"{name}: missing from index.json")
        elif entry["rows"] != len(rows) or entry["group"] != group:
            problems.append(f"{name}: index.json says {entry['rows']} rows in {entry['group']!r}, "
                            f"file has {len(rows)} in {group!r}")
        board["group"] = group
        boards_out.append(board)
        print(f"  {name:34s} rows={len(rows):5d}")

    # One call, so the check cannot drift from the write: derive() is what the
    # collector publishes, including the order the shards' board indices mean.
    boards_out, artifacts = cc.derive(boards_out)
    for a in artifacts:
        path = os.path.join(cc.DATA_DIR, a["path"])
        if not os.path.exists(path):
            problems.append(f"{a['path']} is missing")
        elif load(path) != a["doc"]:
            problems.append(f"{a['path']} does not match derive() over the committed boards")
        if a["empty"]:
            problems.append(f"{a['path']} came out empty over the committed boards")
        print("  " + a["summary"])

    comp = next((b for b in boards_out if b["name"] == cc.COMPOSITE_BOARD), {"rows": []})
    comp_path = os.path.join(cc.BOARDS_DIR, cc.COMPOSITE_BOARD + ".json")
    if os.path.exists(comp_path):
        actual = load(comp_path)
        if actual.get("rows") != comp["rows"]:
            problems.append(f"{cc.COMPOSITE_BOARD}.json does not match build_composite() over the committed boards")
        entry = listed.get(cc.COMPOSITE_BOARD)
        if not entry:
            problems.append(f"{cc.COMPOSITE_BOARD}: missing from index.json")
        elif entry["rows"] != len(comp["rows"]) or entry["group"] != cc.COMPOSITE_GROUP:
            problems.append(f"{cc.COMPOSITE_BOARD}: index.json says {entry['rows']} rows in "
                            f"{entry['group']!r}, file has {len(comp['rows'])} in {cc.COMPOSITE_GROUP!r}")
    else:
        problems.append(f"{cc.COMPOSITE_BOARD}.json is missing")
    print(f"  {cc.COMPOSITE_BOARD:34s} rows={len(comp['rows']):5d} (derived)")

    if problems:
        print("\nFAILED:")
        for p in problems:
            print("  - " + p)
        return 1
    print(f"\nOK: {len(boards_out)} boards (composite included), index and every derived file consistent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
