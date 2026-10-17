// The review gate (docs/agents/feature-workflow.md, steps 5 and 6). `record` runs after each
// Skill call and notes the commit a /code-review or /codebase-design ran on; `gate` runs
// before a merge or a mark-ready and refuses one while the pull request has a commit that
// either skill hasn't seen. Wired in .claude/settings.json, and for cloud threads, which
// start outside the repo, in the user settings install-user-hooks.mjs writes (`--user`).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
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

/* a checkout's "owner/name", from its origin: GitHub's URL, or a proxy's ending the same way */
const slugAt = (dir) =>
  /([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(
    tries(() => run("git", ["remote", "get-url", "origin"], dir)) ?? "",
  )?.[1] ?? null;

/* The checkout of this repo that `dir` is in (a worktree, say), or null when it is in another
   repo. A directory in no repo at all (a cloud thread's /home/user) means this file's. */
function checkout(dir) {
  const top = dir && tries(() => run("git", ["rev-parse", "--show-toplevel"], dir));
  if (!top) return HOME_REPO;
  return slugAt(top) === slugAt(HOME_REPO) ? top : null;
}
const logOf = (dir) =>
  join(
    run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], dir),
    "claude-reviews",
  );
const preToolUse = (fields) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", ...fields } });

function record(input) {
  if (input.tool_name !== "Skill") return;
  const skill = skillName(input.tool_input?.skill ?? "");
  const dir = checkout(input.cwd);
  if (!SKILLS.includes(skill) || !dir) return;
  appendFileSync(logOf(dir), `${skill} ${run("git", ["rev-parse", "HEAD"], dir)}\n`);
}

function gate(input) {
  const target = mergeTarget(input.tool_name, input.tool_input ?? {});
  if (!target) return;
  const dir = checkout(target.cd ? resolve(input.cwd ?? ".", target.cd) : input.cwd);
  const slug = slugAt(HOME_REPO);
  const repo = target.repo ?? (dir ? slug : null);
  if (repo !== slug) return;
  const at = dir ?? HOME_REPO;
  const gh = (...args) => run("gh", ["api", ...args], at);
  const branch = target.branch ?? run("git", ["branch", "--show-current"], at);
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
  if (commits.some((c) => tries(() => run("git", ["cat-file", "-e", c], at)) === null))
    run(
      "git",
      ["fetch", "-q", "origin", gh(`repos/${repo}/pulls/${number}`, "--jq", ".head.ref")],
      at,
    );
  const records = (tries(() => readFileSync(logOf(at), "utf8")) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [skill, sha] = line.split(" ");
      return { skill, sha };
    });
  const isAncestor = (a, b) =>
    tries(() => run("git", ["merge-base", "--is-ancestor", a, b], at)) !== null;
  const missing = Object.entries(unreviewed(commits, records, isAncestor)).filter(
    ([, cs]) => cs.length,
  );
  if (!missing.length) return;
  const first = commits.find((c) => missing.some(([, cs]) => cs.includes(c)));
  const since =
    tries(() => run("git", ["rev-parse", "--short", `${first}^`], at)) ?? first.slice(0, 7);
  const lines = missing.map(
    ([skill, cs]) =>
      `/${skill} hasn't seen: ` +
      cs.map((c) => run("git", ["log", "-1", "--format=%h %s", c], at)).join("; "),
  );
  return preToolUse({
    permissionDecision: "deny",
    permissionDecisionReason:
      `PR #${number} isn't reviewed to its head (docs/agents/feature-workflow.md, steps 5 and 6). ` +
      lines.join(". ") +
      `. Call the Skill tool for 'code-review' with fixed point ${since}, then for 'codebase-design', ` +
      "on the PR's head in this clone, fix what they find, push, and try again. " +
      "Runs in this clone count from any session or worktree; an ad-hoc review or a run on another machine doesn't.",
  });
}

const mode = process.argv[2];
const sameDir = (a, b) => tries(() => realpathSync(a) === realpathSync(b));
// a session that reads the repo's own settings runs the project hooks already
if (
  process.argv.includes("--user") &&
  process.env.CLAUDE_PROJECT_DIR &&
  sameDir(process.env.CLAUDE_PROJECT_DIR, HOME_REPO)
)
  process.exit(0);
const input = JSON.parse(readFileSync(0, "utf8"));
try {
  const out = mode === "record" ? record(input) : gate(input);
  if (out) process.stdout.write(JSON.stringify(out));
} catch (e) {
  // the gate lets a call it can't check through, with a warning
  if (mode === "gate")
    process.stdout.write(
      JSON.stringify(
        preToolUse({
          additionalContext: `The review gate couldn't check this PR (${e.message.split("\n")[0]}); make sure /code-review and /codebase-design have seen its head.`,
        }),
      ),
    );
}
