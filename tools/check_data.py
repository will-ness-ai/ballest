"""
Offline check of the committed data against the collector's own rules, and the
one way to rebuild what it checks.

Needs no Steam credentials: it reads data/ as committed and rebuilds what the
collector derives, so a change to campaign_common.py can be verified without a
live run. Exit status is non-zero on any failure, so it can gate a commit.

  python tools/check_data.py            # check
  python tools/check_data.py --write    # rewrite the derived files, then check
  python tools/check_data.py --data scratch/data   # check a copy (steampy_collect --out)

--write is for the two times the committed derived files legitimately disagree
with the boards: a new artifact whose first copy ships with the code that adds
it, and a branch rebased onto boards that moved underneath it. It writes the
same files write_site does, from the same derive() call, so there is no second
description of what a derived file should contain. It never touches the board
files or index.json: those come from Steam.

Checks:
  - every board in BOARDS has a file, index.json lists it, and the two agree
  - no board is empty, and rows are index-aligned to rank (rows[i].rank == i+1)
  - every file derive() produces from the committed boards — podiums.json and
    players/<shard>.json, the shards over the Workshop boards too, and
    names.json and standings.json — matches the committed copy
  - every derived board file (the composite, Season 1's current Overall) equals
    the one derive() adds, and index.json lists it
  - every Map workshop.json lists with a board has that file, rank-aligned and
    the size the list says, with the top three and shelf stats workshop_stats()
    gives, and no board file is left for a Map it doesn't list
"""

import os, sys, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write(artifacts):
    """Rewrite every derived file from derive()'s list, the way write_site does."""
    for a in artifacts:
        path = os.path.join(cc.DATA_DIR, a["path"])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(a["doc"], f, ensure_ascii=False, separators=(",", ":"))
        print("  wrote " + a["path"])


def main(rewrite=False):
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
                problems.append(
                    f"{name}: rows[{i}].rank is {r.get('rank')}, rows are not rank-aligned"
                )
                break
        entry = listed.get(name)
        if not entry:
            problems.append(f"{name}: missing from index.json")
        elif entry["rows"] != len(rows) or entry["group"] != group:
            problems.append(
                f"{name}: index.json says {entry['rows']} rows in {entry['group']!r}, "
                f"file has {len(rows)} in {group!r}"
            )
        board["group"] = group
        boards_out.append(board)
        print(f"  {name:34s} rows={len(rows):5d}")

    # One call, so the check cannot drift from the write: derive() is what the
    # collector publishes, including the order the shards' board indices mean.
    boards_out, artifacts = cc.derive(boards_out, cc.workshop_boards())
    if rewrite:
        write(artifacts)
    for a in artifacts:
        path = os.path.join(cc.DATA_DIR, a["path"])
        if not os.path.exists(path):
            problems.append(f"{a['path']} is missing")
        elif load(path) != a["doc"]:
            problems.append(f"{a['path']} does not match derive() over the committed boards")
        if a["empty"]:
            problems.append(f"{a['path']} came out empty over the committed boards")
        print("  " + a["summary"])

    steam = {name for name, _ in cc.BOARDS}
    for b in boards_out:
        if b["name"] in steam:
            continue
        name, path = b["name"], os.path.join(cc.BOARDS_DIR, b["name"] + ".json")
        if os.path.exists(path):
            if load(path).get("rows") != b["rows"]:
                problems.append(f"{name}.json does not match derive() over the committed boards")
            entry = listed.get(name)
            if not entry:
                problems.append(f"{name}: missing from index.json")
            elif entry["rows"] != len(b["rows"]) or entry["group"] != b["group"]:
                problems.append(
                    f"{name}: index.json says {entry['rows']} rows in "
                    f"{entry['group']!r}, file has {len(b['rows'])} in {b['group']!r}"
                )
        else:
            problems.append(f"{name}.json is missing")
        print(f"  {name:34s} rows={len(b['rows']):5d} (derived)")

    ws_problems, ws_checked = check_workshop()
    problems += ws_problems

    if problems:
        print("\nFAILED:")
        for p in problems:
            print("  - " + p)
        return 1
    print(
        f"\nOK: {len(boards_out)} boards (derived included), index and every derived file consistent; "
        f"{ws_checked} Workshop boards checked"
    )
    return 0


def check_workshop():
    """The Workshop list against its board files. Returns (problems, Maps checked).
    Missing entirely is fine (a checkout from before Workshop Maps); a list and
    files that disagree is not, and neither is a list with no board to check."""
    ws = cc.load_workshop()
    if ws is None:
        print("  workshop.json absent; skipping Workshop checks")
        return [], 0
    problems, files = [], set()
    for m in ws.get("maps", []):
        if not m.get("file"):
            continue
        files.add(os.path.basename(m["file"]))
        path = os.path.join(cc.DATA_DIR, m["file"])
        if not os.path.exists(path):
            problems.append(f"Workshop Map {m['pfid']}: no board file {m['file']}")
            continue
        rows = load(path).get("rows") or []
        if not rows:
            problems.append(f"Workshop Map {m['pfid']}: empty board file")
        if len(rows) != m.get("rows"):
            problems.append(
                f"Workshop Map {m['pfid']}: workshop.json says {m.get('rows')} rows, "
                f"file has {len(rows)}"
            )
        if any(r.get("rank") != i + 1 for i, r in enumerate(rows)):
            problems.append(f"Workshop Map {m['pfid']}: rows are not rank-aligned")
        # names aside: the list's top three carry this run's names, which can be newer
        # than a board file that was not re-read
        if rows:
            want = cc.workshop_stats(m, rows)
            same = lambda k, v: (
                [[t[0], t[2]] for t in v] == [[t[0], t[2]] for t in m.get(k) or []]
                if k == "top3"
                else m.get(k) == v
            )
            if not all(same(k, v) for k, v in want.items()):
                problems.append(
                    f"Workshop Map {m['pfid']}: top three or shelf stats do not match its board file"
                )
    if os.path.isdir(cc.WORKSHOP_DIR):
        for fname in os.listdir(cc.WORKSHOP_DIR):
            if fname.endswith(".json") and fname not in files:
                problems.append(f"workshop/{fname} belongs to no Map in workshop.json")
    print(f"  workshop.json  {len(ws.get('maps', []))} Maps, {len(files)} board files")
    if not files:
        problems.append("workshop.json lists no Map with a board file: nothing was checked")
    return problems, len(files)


if __name__ == "__main__":
    if "--data" in sys.argv[1:]:
        cc.use_data_dir(sys.argv[sys.argv.index("--data") + 1])
    sys.exit(main(rewrite="--write" in sys.argv[1:]))
