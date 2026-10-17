// What the review gate decides, kept apart from git and gh so it can be tested
// (web/test/review-gate.test.ts). review-gate.mjs is the hook that runs it.

export const SKILLS = ["code-review", "codebase-design"];

// a command's start (a line's, or after a separator), then any env assignments
const START = String.raw`(?:^|[;&|(\n]\s*)(?:\w+=\S*\s+)*`;
const GH_PR = new RegExp(
  START + String.raw`gh\s+(?:(?:-R|--repo)[\s=]+(\S+)\s+)?pr\s+(merge|ready)\b([^;&|\n]*)`,
);
const REST =
  /(?:gh\s+api|curl)\b([^;&|\n]*?)repos\/([^/\s]+\/[^/\s]+)\/pulls\/(\d+)\/(?:merge|ccr\/ready_for_review|ccr\/auto_merge)\b([^;&|\n]*)/;
const GRAPHQL =
  /gh\s+api\s+graphql\b[\s\S]*?\b(?:mergePullRequest|enablePullRequestAutoMerge|markPullRequestReadyForReview)\b/;
const CD = /(?:^|[;&(\n]\s*)cd\s+(\S+)/g;
// gh pr merge's flags that take a value, so the value isn't read as the PR
const VALUED = /^(?:-[btFRA]|--(?:body|body-file|subject|repo|author-email|match-head-commit))$/;

const TOOLS = ["mcp__github__merge_pull_request", "mcp__github__enable_pr_auto_merge"];

/* The pull request a tool call merges or marks ready, as { repo: "owner/name" | null,
   number | null, branch?, cd? }, or null for any other call. A null repo is the checkout's
   (in `cd`, when the command moves there first); a null number is its branch's PR, or
   `branch`'s. */
export function mergeTarget(tool, input) {
  const pr = { repo: `${input.owner}/${input.repo}`, number: input.pullNumber };
  if (TOOLS.includes(tool)) return pr;
  if (tool === "mcp__github__update_pull_request") return input.draft === false ? pr : null;
  if (tool !== "Bash") return null;
  const command = String(input.command ?? "");
  const rest = REST.exec(command);
  if (rest) {
    if (/(?:-X|--method|--request)[\s=]*DELETE/i.test(rest[1] + rest[4])) return null;
    return { repo: rest[2], number: Number(rest[3]) };
  }
  const graphql = GRAPHQL.exec(command);
  if (graphql) return withCd({ repo: null, number: null }, command, graphql.index);
  const gh = GH_PR.exec(command);
  if (!gh) return null;
  const [, globalRepo, verb, args] = gh;
  if (verb === "ready" && /(?:^|\s)--undo\b/.test(args)) return null;
  const tokens = args
    .replace(/'[^']*'|"[^"]*"/g, "''")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let repo = globalRepo ?? null;
  let first = null;
  for (let i = 0; i < tokens.length; i++) {
    if (VALUED.test(tokens[i])) {
      if (/^(?:-R|--repo)$/.test(tokens[i])) repo = tokens[i + 1];
      i++;
    } else if (/^--repo=/.test(tokens[i])) repo = tokens[i].slice(7);
    else if (!tokens[i].startsWith("-") && first === null) first = tokens[i];
  }
  const target = { repo, number: null };
  const url = first && /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(first);
  if (url) return { repo: url[1], number: Number(url[2]) };
  if (first && /^#?\d+$/.test(first)) target.number = Number(first.replace("#", ""));
  else if (first) target.branch = first;
  return withCd(target, command, gh.index);
}

/* the last `cd` before `at` names the checkout the command runs in */
function withCd(target, command, at) {
  const cds = [...command.matchAll(CD)].filter((m) => m.index < at);
  return cds.length && target.repo === null ? { ...target, cd: cds.at(-1)[1] } : target;
}

/* "projectSettings:code-review" and "code-review" are the same skill */
export const skillName = (name) => String(name).split(":").pop();

/* Each skill's commits that no run of it has seen: a run on a commit sees it and every
   commit before it. `records` are { skill, sha }, `isAncestor(a, b)` is git's. */
export function unreviewed(commits, records, isAncestor) {
  return Object.fromEntries(
    SKILLS.map((skill) => {
      const seen = records.filter((r) => r.skill === skill).map((r) => r.sha);
      return [skill, commits.filter((c) => !seen.some((s) => isAncestor(c, s)))];
    }),
  );
}
