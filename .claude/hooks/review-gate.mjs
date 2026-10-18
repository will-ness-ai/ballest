// The review gate (docs/agents/feature-workflow.md, steps 5 and 6). `record` runs after each
// Skill call and notes the commit a /code-review or /codebase-design ran on; `gate` runs
// before a merge or a mark-ready and refuses one while the pull request has a commit that
// either skill hasn't seen. Wired in .claude/settings.json, and for cloud threads, which
// start outside the repo, in the user settings install-user-hooks.mjs writes (`--user`).
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FOLLOW_UP_LINES,
  SKILLS,
  mergeTargets,
  notSquash,
  repoSlug,
  skillName,
  unreviewed,
} from "./review-gate-rules.mjs";

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

/* a checkout's "owner/name", from its origin */
const slugAt = (dir) => {
  const url = tries(() => run("git", ["remote", "get-url", "origin"], dir));
  return url && repoSlug(url);
};

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

/* where a `cd` lands, or null when it can't be told from here (a missing directory) */
function landing(cwd, cd) {
  const path = resolve(cwd ?? ".", cd.replace(/^~(?=\/|$)|^\$HOME\b|^\$\{HOME\}/, homedir()));
  return existsSync(path) ? path : null;
}

/* The checkout a target's command runs in, this repo's slug, and whether the target is one
   of this repo's PRs. Throws when a `cd` lands nowhere. */
function locate(target, cwd) {
  const where = target.cd ? landing(cwd, target.cd) : cwd;
  if (target.cd && !where) throw new Error(`can't find ${target.cd}`);
  const dir = checkout(where);
  const slug = slugAt(HOME_REPO);
  const ours = !target.opaque && (target.repo ? repoSlug(target.repo) : dir && slug) === slug;
  return { dir, slug, ours };
}

/* Why the gate refuses to let `target` merge, or null when it may (or is another repo's).
   Throws when it can't tell, which the caller turns into a warning. */
function refusal(target, cwd) {
  const { dir, slug, ours } = locate(target, cwd);
  if (target.opaque)
    return dir
      ? "A GraphQL mutation names its PR by node ID, so the review gate can't check it: merge with `gh pr merge <number>` instead."
      : null;
  if (!ours) return null;
  const at = dir ?? HOME_REPO;
  const gh = (...args) => run("gh", ["api", ...args], at);
  const branch = target.branch ?? run("git", ["branch", "--show-current"], at);
  const number =
    target.number ??
    Number(gh(`repos/${slug}/pulls?head=${slug.split("/")[0]}:${branch}`, "--jq", ".[0].number"));
  if (!number) throw new Error(`no open PR for ${branch}`);
  const commits = gh(
    `repos/${slug}/pulls/${number}/commits`,
    "--paginate",
    "--jq",
    ".[] | select((.parents | length) == 1) | .sha",
  )
    .split("\n")
    .filter(Boolean);
  if (commits.some((c) => tries(() => run("git", ["cat-file", "-e", c], at)) === null))
    run(
      "git",
      ["fetch", "-q", "origin", gh(`repos/${slug}/pulls/${number}`, "--jq", ".head.ref")],
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
  const linesOf = (c) =>
    run("git", ["show", "--numstat", "--format=", c], at)
      .split("\n")
      .reduce((sum, line) => {
        const [added, removed] = line.split("\t");
        // git counts a binary file's lines as "-": no follow-up is small enough to skip it
        return added === "-" ? Infinity : sum + (Number(added) || 0) + (Number(removed) || 0);
      }, 0);
  const missing = Object.entries(unreviewed(commits, records, isAncestor, linesOf)).filter(
    ([, cs]) => cs.length,
  );
  if (!missing.length) return null;
  const first = commits.find((c) => missing.some(([, cs]) => cs.includes(c)));
  const since =
    tries(() => run("git", ["rev-parse", "--short", `${first}^`], at)) ?? first.slice(0, 7);
  const lines = missing.map(
    ([skill, cs]) =>
      `/${skill} hasn't seen: ` +
      cs.map((c) => run("git", ["log", "-1", "--format=%h %s", c], at)).join("; "),
  );
  return (
    `PR #${number} isn't reviewed to its head (docs/agents/feature-workflow.md, steps 5 and 6). ` +
    lines.join(". ") +
    `. Commits after a run need no new one while they change fewer than ${FOLLOW_UP_LINES} lines in all` +
    `. Call the Skill tool for 'code-review' with fixed point ${since}, then for 'codebase-design', ` +
    "on the PR's head in this clone, fix what they find, push, and try again. " +
    "Runs in this clone count from any session or worktree; an ad-hoc review or a run on another machine doesn't."
  );
}

function gate(input) {
  const targets = mergeTargets(input.tool_name, input.tool_input ?? {});
  if (
    notSquash(input.tool_name, input.tool_input ?? {}) &&
    targets.some((t) => tries(() => locate(t, input.cwd).ours))
  )
    return preToolUse({
      permissionDecision: "deny",
      permissionDecisionReason: `This repo squash-merges (docs/agents/issue-tracker.md): use \`gh api -X PUT repos/${slugAt(HOME_REPO)}/pulls/<n>/merge -f merge_method=squash\`, \`gh pr merge --squash\`, or merge_method squash.`,
    });
  for (const target of targets) {
    const reason = refusal(target, input.cwd);
    if (reason) return preToolUse({ permissionDecision: "deny", permissionDecisionReason: reason });
  }
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
