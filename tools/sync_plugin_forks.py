"""
Brings Will's forks of AnythingGoes's plugin repos level with upstream, on GitHub and in
the local checkouts beside this repo. Run it at the start of a plugin session.

  python tools/sync_plugin_forks.py

For each fork: `gh repo sync` fast-forwards the fork's main to upstream's main (it refuses
if the fork's main has commits of its own, which the fork rules forbid), then the checkout
next to this repo fetches both remotes and moves its own main along with a fast-forward.
A checkout that is missing is reported, not cloned; a missing `upstream` remote is added.
Feature branches are left alone. Nothing is ever force-pushed. docs/agents/plugins.md has
the layout and the rules this follows.
"""

import subprocess
import sys
from pathlib import Path

PROJECTS = Path(__file__).resolve().parents[2]

# (checkout folder next to this repo, Will's fork, AnythingGoes's repo)
FORKS = [
    (
        "ballest-plugin-manager",
        "will-ness-ai/ballest-plugin-manager",
        "AnythingGoes-ballest/ballest-plugin-manager",
    ),
    (
        "ballest-grind-stats",
        "will-ness-ai/ballest-grind-stats",
        "AnythingGoes-ballest/ballest-grind-stats",
    ),
]


def run(args, cwd=None):
    return subprocess.run(  # noqa: S603 (git and gh with our own arguments)
        args, cwd=cwd, capture_output=True, text=True, check=False
    )


def git(repo, *args):
    return run(["git", *args], cwd=repo)


def sync(folder, fork, upstream):
    synced = run(["gh", "repo", "sync", fork, "--branch", "main"])
    if synced.returncode != 0:
        return f"{fork}: GitHub sync refused: {(synced.stderr or synced.stdout).strip()}"
    repo = PROJECTS / folder
    if not (repo / ".git").exists():
        return f"{fork}: synced on GitHub; no checkout at {repo}"
    if git(repo, "remote", "get-url", "upstream").returncode != 0:
        git(repo, "remote", "add", "upstream", f"https://github.com/{upstream}.git")
    for remote in ("origin", "upstream"):
        fetched = git(repo, "fetch", "--prune", remote)
        if fetched.returncode != 0:
            return f"{fork}: fetch {remote} failed: {fetched.stderr.strip()}"
    if git(repo, "merge-base", "--is-ancestor", "main", "origin/main").returncode != 0:
        return f"{fork}: local main has commits origin/main lacks; left as is"
    current = git(repo, "branch", "--show-current").stdout.strip()
    if current == "main":
        moved = git(repo, "merge", "--ff-only", "origin/main")
    else:
        moved = git(repo, "branch", "-f", "main", "origin/main")
    if moved.returncode != 0:
        return f"{fork}: couldn't move local main: {moved.stderr.strip()}"
    head = git(repo, "log", "--oneline", "-1", "main").stdout.strip()
    return f"{fork}: main at {head} (on branch {current or 'detached'})"


def main():
    failed = False
    for folder, fork, upstream in FORKS:
        line = sync(folder, fork, upstream)
        failed = failed or "refused" in line or "failed" in line or "couldn't" in line
        print(line)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
