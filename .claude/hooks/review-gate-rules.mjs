// What the review gate decides, kept apart from git and gh so it can be tested
// (web/test/review-gate.test.ts). review-gate.mjs is the hook that runs it.

export const SKILLS = ["code-review", "codebase-design"];

// Bash calls that merge or mark ready. Matched anywhere in a command (wrappers like
// `timeout` or `bash -c` included), so one that only mentions a merge is checked too.
const GH_PR = /(?<![\w./-])gh\s+(?:(?:-R|--repo)[\s=]+(\S+)\s+)?pr\s+(merge|ready)\b/g;
const API = /(?<![\w./-])(gh\s+api|curl)\b/g;
const ROUTE =
  /repos\/([^/\s'"]+\/[^/\s'"]+)\/pulls\/(\d+)\/(?:merge|ccr\/ready_for_review|ccr\/auto_merge)\b/;
const MUTATION =
  /\b(?:mergePullRequest|enablePullRequestAutoMerge|markPullRequestReadyForReview)\b/;
// a request that writes: a method, or gh api's fields (which make it a POST)
const WRITES = /(?:-X|--method|--request)[\s=]*['"]?(?:PUT|POST|PATCH)\b/i;
const GH_FIELDS = /\s(?:-[fF]|--(?:field|raw-field|input))\b/;
// a cd, as a command of its own (inside `bash -c "..."` or an if/then too)
const CD = /(?:^|[;&(\n'"]|\b(?:then|do|else)\b)\s*cd\s+("[^"]*"|'[^']*'|[^\s;&|)'"]+)/g;
const SEPARATOR = /[;&|\n]/;
// GH_REPO set in front of the gh call itself, or exported earlier in the command
const GH_REPO_PREFIX = /\bGH_REPO=([^\s;&|]+)\s+[^;&|\n]*$/;
const GH_REPO_EXPORT = /\bexport\s+GH_REPO=([^\s;&|]+)/g;
// gh pr merge's flags that take a value, so the value isn't read as the PR
const VALUED = /^(?:-[btFRA]|--(?:body|body-file|subject|repo|author-email|match-head-commit))$/;

const MERGE_TOOLS = ["mcp__github__merge_pull_request", "mcp__github__enable_pr_auto_merge"];

/* The pull requests a tool call merges or marks ready, in order: { repo: "owner/name" | null,
   number | null, branch?, cd? }, or { opaque: true } for a GraphQL mutation, which names its
   PR by node ID. A null repo is the checkout's (in `cd`, when the command moves there
   first); a null number is its branch's PR, or `branch`'s. */
export function mergeTargets(tool, input) {
  const pr = { repo: `${input.owner}/${input.repo}`, number: input.pullNumber };
  if (MERGE_TOOLS.includes(tool)) return [pr];
  if (tool === "mcp__github__update_pull_request") return input.draft === false ? [pr] : [];
  if (tool !== "Bash") return [];
  const command = String(input.command ?? "");
  const found = [
    ...[...command.matchAll(GH_PR)].map((m) => [m.index, ghPr(command, m)]),
    ...[...command.matchAll(API)].map((m) => [m.index, apiCall(command, m)]),
  ];
  return found
    .filter(([, t]) => t)
    .sort(([a], [b]) => a - b)
    .map(([at, t]) => (t.repo ? t : withCd(t, command, at)));
}

/* the text with each quoted string as one bare word, so its spaces and separators don't split it */
const flatten = (text) =>
  text.replace(/'([^']*)'|"([^"]*)"/g, (_, single, double) =>
    (single ?? double).replace(/[\s;&|]/g, "_"),
  );
const unquote = (text) => text.replace(/['"]/g, "");

/* `gh pr merge|ready [args]` */
function ghPr(command, m) {
  const [whole, globalRepo, verb] = m;
  const args = flatten(command.slice(m.index + whole.length)).split(SEPARATOR)[0];
  const tokens = args.trim().split(/\s+/).map(unquote).filter(Boolean);
  if (tokens.includes(verb === "ready" ? "--undo" : "--disable-auto")) return null;
  // GH_REPO counts when exported earlier, or set in front of this gh call
  const before = command.slice(0, m.index);
  const repoVar = GH_REPO_PREFIX.exec(before) ?? [...before.matchAll(GH_REPO_EXPORT)].at(-1);
  let repo = globalRepo ?? (repoVar ? unquote(repoVar[1]) : null);
  let first = null;
  for (let i = 0; i < tokens.length; i++) {
    if (VALUED.test(tokens[i])) {
      if (/^(?:-R|--repo)$/.test(tokens[i])) repo = tokens[i + 1];
      i++;
    } else if (tokens[i].startsWith("--repo=")) repo = tokens[i].slice(7);
    else if (!tokens[i].startsWith("-") && first === null) first = tokens[i];
  }
  const url = first && /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(first);
  if (url) return { repo: url[1], number: Number(url[2]) };
  if (first && /^#?\d+$/.test(first)) return { repo, number: Number(first.replace("#", "")) };
  return first ? { repo, number: null, branch: first } : { repo, number: null };
}

/* `gh api` or `curl` on a route that merges or marks ready, or a GraphQL mutation that does */
function apiCall(command, m) {
  const rest = command.slice(m.index + m[0].length);
  if (/^\s+graphql\b/.test(rest) || /\/graphql\b/.test(rest.split(SEPARATOR)[0]))
    return MUTATION.test(rest) ? { opaque: true } : null;
  const call = flatten(rest).split(SEPARATOR)[0];
  const route = ROUTE.exec(call);
  if (!route) return null;
  const writes = WRITES.test(call) || (m[1].startsWith("gh") && GH_FIELDS.test(call));
  if (!writes) return null;
  // gh fills in {owner}/{repo} and :owner/:repo from the checkout
  const placeholder = /^(?:\{owner\}\/\{repo\}|:owner\/:repo)$/.test(route[1]);
  return { repo: placeholder ? null : route[1], number: Number(route[2]) };
}

/* where `cd to` lands from `from`: an absolute path (or ~, $HOME) starts again */
const joinCd = (from, to) => (/^[/~$]/.test(to) || !from ? to : `${from}/${to}`);

/* the cds before `at`, each from the last, name the checkout the command runs in */
function withCd(target, command, at) {
  const cd = [...command.matchAll(CD)]
    .filter((c) => c.index < at)
    .map((c) => unquote(c[1]))
    // `cd -` goes back to where the last cd left
    .reduce(
      ([from, last], to) => (to === "-" ? [last, from] : [joinCd(from, to), from]),
      ["", ""],
    )[0];
  return cd ? { ...target, cd } : target;
}

/* "owner/name", lower case, from gh's -R forms or a remote URL (GitHub's or a proxy's) */
export function repoSlug(text) {
  const parts = String(text)
    .toLowerCase()
    .replace(/\.git\/?$|\/$/, "")
    .split(/[/:]/);
  return parts.slice(-2).join("/");
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
