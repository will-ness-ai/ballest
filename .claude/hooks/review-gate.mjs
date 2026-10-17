// The review gate (docs/agents/feature-workflow.md, steps 5 and 6). `record` runs after each
// Skill call and notes the commit a /code-review or /codebase-design ran on; `gate` runs
// before a merge or a mark-ready and refuses one while the pull request has a commit that
// either skill hasn't seen. Wired in .claude/settings.json, and for cloud threads, which
// start outside the repo, in the user settings session-start.sh writes.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SKILLS, mergeTarget, skillName, unreviewed } from "./review-gate-rules.mjs";

const HOME_REPO = fileURLToPath(new URL("../..", import.meta.url));

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const tries = (f) => {
  try {
    return f();
  } catch {
    return null;
  }
};

/* "owner/name" from a remote URL: GitHub's, or a proxy's that ends in the same two parts */
const slugOf = (url) => /([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? null;
const SLUG = slugOf(run("git", ["remote", "get-url", "origin"], HOME_REPO));

/* the session's checkout of this repo (a worktree, say), else this file's */
function checkout(cwd) {
  const top = cwd && tries(() => run("git", ["rev-parse", "--show-toplevel"], cwd));
  return top && slugOf(tries(() => run("git", ["remote", "get-url", "origin"], top)) ?? "") === SLUG
    ? top
    : HOME_REPO;
}
const logOf = (dir) =>
  join(
    run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], dir),
    "claude-reviews",
  );

function record(input, dir) {
  if (input.tool_name !== "Skill") return;
  const skill = skillName(input.tool_input?.skill ?? "");
  if (!SKILLS.includes(skill)) return;
  appendFileSync(logOf(dir), `${skill} ${run("git", ["rev-parse", "HEAD"], dir)}\n`);
}

function gate(input, dir) {
  const target = mergeTarget(input.tool_name, input.tool_input ?? {});
  if (!target) return;
  const repo = target.repo ?? SLUG;
  if (repo !== SLUG) return;
  const gh = (...args) => run("gh", ["api", ...args], dir);
  const branch = run("git", ["branch", "--show-current"], dir);
  const number =
    target.number ??
    Number(gh(`repos/${repo}/pulls?head=${repo.split("/")[0]}:${branch}`, "--jq", ".[0].number"));
  if (!number) return;
  const commits = gh(
    `repos/${repo}/pulls/${number}/commits`,
    "--paginate",
    "--jq",
    ".[] | select((.parents | length) == 1) | .sha",
  )
    .split("\n")
    .filter(Boolean);
  if (commits.some((c) => tries(() => run("git", ["cat-file", "-e", c], dir)) === null))
    run(
      "git",
      ["fetch", "-q", "origin", gh(`repos/${repo}/pulls/${number}`, "--jq", ".head.ref")],
      dir,
    );
  const records = (tries(() => readFileSync(logOf(dir), "utf8")) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [skill, sha] = line.split(" ");
      return { skill, sha };
    });
  const isAncestor = (a, b) =>
    tries(() => run("git", ["merge-base", "--is-ancestor", a, b], dir)) !== null;
  const missing = Object.entries(unreviewed(commits, records, isAncestor)).filter(
    ([, cs]) => cs.length,
  );
  if (!missing.length) return;
  const first = commits.find((c) => missing.some(([, cs]) => cs.includes(c)));
  const since =
    tries(() => run("git", ["rev-parse", "--short", `${first}^`], dir)) ?? first.slice(0, 7);
  const lines = missing.map(
    ([skill, cs]) =>
      `/${skill} hasn't seen: ` +
      cs.map((c) => run("git", ["log", "-1", "--format=%h %s", c], dir)).join("; "),
  );
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `PR #${number} isn't reviewed to its head (docs/agents/feature-workflow.md, steps 5 and 6). ` +
        lines.join(". ") +
        `. Call the Skill tool for 'code-review' with fixed point ${since}, then for 'codebase-design', ` +
        "in this session on the PR's head, fix what they find, push, and try again. " +
        "A run in another session or an ad-hoc review doesn't count.",
    },
  };
}

const input = JSON.parse(readFileSync(0, "utf8"));
const mode = process.argv[2];
try {
  const out = (mode === "record" ? record : gate)(input, checkout(input.cwd));
  if (out) process.stdout.write(JSON.stringify(out));
} catch (e) {
  if (mode === "gate")
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: `The review gate couldn't check this PR (${e.message.split("\n")[0]}); make sure /code-review and /codebase-design have seen its head.`,
        },
      }),
    );
}
