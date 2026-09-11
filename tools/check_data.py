"""
Offline check of the committed data against the collector's own rules.

Needs no Steam credentials: it reads data/ as committed and rebuilds what the
collector derives, so a change to campaign_common.py can be verified without a
live run. Exit status is non-zero on any failure, so it can gate a commit.

  python tools/check_data.py

Checks:
  - every board in BOARDS has a file, index.json lists it, and the two agree
  - no board is empty, and rows are index-aligned to rank (rows[i].rank == i+1)
  - podiums.json equals build_podiums() over the committed boards
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

    expected = {"seasons": cc.build_podiums(boards_out)}
    if os.path.exists(cc.PODIUMS_PATH):
        actual = load(cc.PODIUMS_PATH)
        if actual != expected:
            problems.append("podiums.json does not match build_podiums() over the committed boards")
    else:
        problems.append("podiums.json is missing")
    for s in expected["seasons"]:
        print(f"  podiums {s['group']:10s} tracks={s['tracks']:2d} players={len(s['players'])}")

    if problems:
        print("\nFAILED:")
        for p in problems:
            print("  - " + p)
        return 1
    print(f"\nOK: {len(boards_out)} boards, index and podiums consistent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
