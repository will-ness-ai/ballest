"""Spawn a Generator's Prefab in a sandboxed copy of the game and screenshot it.

    python .claude/skills/prefab-generators/spawn.py <slot> <key> ['<json>'] [--sandbox PATH]

Run from the repo root on Will's PC, with a slot started and its level editor open:

    python <sandbox.py> start 1 --host build/version.dll
    python <sandbox.py> run 1 -c "open Map_LevelEditorMain; sleep 12"

`--host` runs the plugin manager fork's own build (`./build.sh` in that checkout) until a release
reads several test commands a write, which sandbox.py's `keys` needs. It writes the file into the
slot's Prefabs folder, types `ballest.editor.spawnprefab` into the game's console in one write
(the host's `console` test command doesn't run it) and shoots; Enter closes
the console, and Escape would open the editor's menu. The prefab appears in front of the
editor's camera, which looks along +X, so a big one fills the view: spawn a small variation
to see all of it. Prints the screenshot's path.
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("slot", type=int)
ap.add_argument("key")
ap.add_argument("change", nargs="?", default="{}")
# sandbox.py lives on the plugin manager fork's sandbox-tools branches (docs/agents/plugins.md)
CHECKOUTS = ["../bpm-sandbox-tools/tools/sandbox.py", "../ballest-plugin-manager/tools/sandbox.py"]
ap.add_argument(
    "--sandbox",
    default=next((p for p in CHECKOUTS if Path(p).is_file()), CHECKOUTS[0]),
    help="sandbox.py; the first of " + ", ".join(CHECKOUTS) + " that exists",
)
args = ap.parse_args()

# a name the console can type: letters and digits only (an underscore needs shift)
name = "gen" + re.sub(r"[^a-z0-9]", "", args.key.lower())
folder = (
    Path(os.environ["LOCALAPPDATA"])
    / f"BallestTest{args.slot}"
    / "UserDir"
    / "Saved"
    / "SaveGames"
    / "Prefabs"
)
folder.mkdir(parents=True, exist_ok=True)
tsx = Path("web/node_modules/.bin") / ("tsx.cmd" if os.name == "nt" else "tsx")
subprocess.run(  # noqa: S603 (web's tsx with our own arguments)
    [
        str(tsx),
        ".claude/skills/prefab-generators/write-prefab.ts",
        args.key,
        args.change,
        str(folder / f"{name}.json"),
    ],
    check=True,
)


shot = f"spawn-{name}"
# `post 192` opens the console; any key posted while it is closed is an editor shortcut
lines = [
    "post 192",
    f"keys ballest.editor.spawnprefab {name}",
    "post 13",
    "sleep 2",
    f"shot {shot}",
]
with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
    f.write("\n".join(lines) + "\n")
run = subprocess.run(  # noqa: S603 (sandbox.py with our own arguments)
    [sys.executable, args.sandbox, "run", str(args.slot), "--file", f.name],
    capture_output=True,
    text=True,
    check=False,
)
os.unlink(f.name)
found = re.search(r'"?([A-Za-z]:\\[^"\n]*' + re.escape(shot) + r"\.png)", run.stdout)
print(found.group(1).replace("\\\\", "\\") if found else run.stdout + run.stderr)
