// What the review gate decides, kept apart from git and gh so it can be tested
// (web/test/review-gate.test.ts). review-gate.mjs is the hook that runs it.

export const SKILLS = ["code-review", "codebase-design"];

// Bash calls that merge or mark ready. Matched anywhere in a command (wrappers like
// `timeout` or `bash -c` included), so one that only mentions a merge is checked too.
const GH_PR = /(?<![\w./-])gh\s+(?:(?:-R|--repo)[\s=]+(\S+)\s+)?pr\s+(merge|ready)\b/g;
const API = /(?<![\w./-])(gh\s+api|curl)\b/g;
// `pnpm pr land <n>` (web/scripts/pr.mjs) marks ready and squash-merges from inside the script
const LAND = /(?<![\w./-])(pnpm|node)\s/g;
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

/* The pull requests a tool call merges or marks ready, in order: { repo: "owner/name" | null,
   number | null, branch?, cd?, unsquashed? }, or { opaque: true } for a GraphQL mutation,
   which names its PR by node ID. A null repo is the checkout's (in `cd`, when the command
   moves there first); a null number is its branch's PR, or `branch`'s. `unsquashed` marks a
   merge that doesn't squash: GitHub's REST merge, like gh's prompt, makes a merge commit
   unless told otherwise, and this repo squash-merges (docs/agents/issue-tracker.md). The
   ccr/auto_merge route's method isn't read, so it is never marked. */
export function mergeTargets(tool, input) {
  const pr = { repo: `${input.owner}/${input.repo}`, number: input.pullNumber };
  if (tool === "mcp__github__merge_pull_request")
    return [input.merge_method === "squash" ? pr : { ...pr, unsquashed: true }];
  if (tool === "mcp__github__enable_pr_auto_merge")
    return [
      String(input.mergeMethod).toUpperCase() === "SQUASH" ? pr : { ...pr, unsquashed: true },
    ];
  if (tool === "mcp__github__update_pull_request") return input.draft === false ? [pr] : [];
  if (tool !== "Bash") return [];
  const command = String(input.command ?? "");
  const found = [
    ...[...command.matchAll(GH_PR)].map((m) => [m.index, ghPr(command, m)]),
    ...[...command.matchAll(API)].map((m) => [m.index, apiCall(command, m)]),
    ...[...command.matchAll(LAND)].map((m) => [m.index, landCall(command, m)]),
  ];
  return found
    .filter(([, t]) => t)
    .sort(([a], [b]) => a - b)
    .map(([at, t]) => (t.repo ? t : withCd(t, command, at)))
    .map(({ dir, ...t }) => (dir ? { ...t, cd: joinCd(t.cd ?? "", dir) } : t));
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
  // gh pr merge's flags without a value can share one dash: -sd
  const squash = tokens.some((t) => t === "--squash" || /^-[dmrs]*s[dmrs]*$/.test(t));
  const marked = verb === "merge" && !squash ? { unsquashed: true } : {};
  const url = first && /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(first);
  if (url) return { repo: url[1], number: Number(url[2]), ...marked };
  if (first && /^#?\d+$/.test(first))
    return { repo, number: Number(first.replace("#", "")), ...marked };
  return { repo, number: null, ...(first ? { branch: first } : {}), ...marked };
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
  // merge_method=squash, or in a JSON body, quoted or escaped
  const squash = /merge_method[\\"'_\s]*[:=][\\"'_\s]*squash\b/.test(call);
  const marked = /\/pulls\/\d+\/merge\b/.test(call) && !squash ? { unsquashed: true } : {};
  return { repo: placeholder ? null : route[1], number: Number(route[2]), ...marked };
}

/* `pnpm [--silent|-s|run|--dir <d>] pr land <n>` or `node <..>/scripts/pr.mjs land <n>`: the
   PR it lands, with `dir` for a --dir or -C (pr.mjs squash-merges, so never unsquashed) */
function landCall(command, m) {
  const call = flatten(command.slice(m.index + m[0].length)).split(SEPARATOR)[0];
  const tokens = call.trim().split(/\s+/).map(unquote).filter(Boolean);
  let dir = null;
  let i = 0;
  if (m[1] === "node") {
    if (!/(?:^|\/)scripts\/pr\.mjs$/.test(tokens[0] ?? "")) return null;
    i = 1;
  } else {
    for (; i < tokens.length && tokens[i] !== "pr"; i++) {
      if (/^(?:--dir|-C)$/.test(tokens[i])) dir = tokens[++i];
      else if (!/^(?:--silent|-s|run|--dir=.*)$/.test(tokens[i])) return null;
      else if (tokens[i].startsWith("--dir=")) dir = tokens[i].slice(6);
    }
    i++;
  }
  if (tokens[i] !== "land" || tokens.includes("--help")) return null;
  const rest = tokens.slice(i + 1).filter((t, j, all) => all[j - 1] !== "--timeout");
  const n = rest.find((t) => /^#?\d+$/.test(t));
  if (n === undefined) return null;
  return { repo: null, number: Number(n.replace("#", "")), ...(dir ? { dir } : {}) };
}

/* where `cd to` lands from `from`: an absolute path (or ~, $HOME) starts again */
const joinCd = (from, to) => (/^[/~$]/.test(to) || !from ? to : `${from}/${to}`);

/* the cds before `at`, each from the last, name the checkout the command runs in */
function withCd(target, command, at) {
  // like the shell's PWD and OLDPWD, relative to where the command starts ("")
  const { pwd: cd } = [...command.matchAll(CD)]
    .filter((c) => c.index < at)
    .map((c) => unquote(c[1]))
    .reduce(
      ({ pwd, oldpwd }, to) =>
        to === "-" ? { pwd: oldpwd, oldpwd: pwd } : { pwd: joinCd(pwd, to), oldpwd: pwd },
      { pwd: "", oldpwd: "" },
    );
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

// Claude Code's own skills of the same name: the Skill tool always finds these
const BUILT_IN = ["code-review"];

/* Whether this session's Skill tool can find `skill`: built in, or a SKILL.md in one of the
   skill folders it read at its start (`dirs`), unless the tool has called it unknown
   (`refused`): a project thread's linked skills can still be missing from it (PR #368).
   `exists(path)` is the file system's. */
export const loadable = (skill, dirs, exists, refused = new Set()) =>
  BUILT_IN.includes(skill) ||
  (!refused.has(skill) && dirs.some((d) => exists(`${d}/${skill}/SKILL.md`)));

/* The skills a session's transcript (JSONL) shows its Skill tool refusing as unknown, and not
   run since. Only the Skill tool's own results count, so a file or a command's output that
   quotes the error doesn't; a refusal counts by the bare name the error gives (a prefixed one,
   "foo:codebase-design", says nothing of the bare one), and any call that runs it clears it. */
export function refusedSkills(transcript) {
  const asked = new Map();
  const refused = new Set();
  for (const line of transcript.split("\n")) {
    if (!line.includes('"Skill"') && ![...asked.keys()].some((id) => line.includes(id))) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content)
      if (part?.type === "tool_use" && part.name === "Skill")
        asked.set(part.id, skillName(String(part.input?.skill ?? "").replace(/^\//, "")));
      else if (part?.type === "tool_result" && asked.has(part.tool_use_id)) {
        const text = typeof part.content === "string" ? part.content : JSON.stringify(part.content);
        const named = part.is_error && /Unknown skill: \/?([\w-]+)(?![\w:-])/.exec(text)?.[1];
        if (named) refused.add(named);
        else if (!part.is_error) refused.delete(asked.get(part.tool_use_id));
        asked.delete(part.tool_use_id);
      }
  }
  return refused;
}

// Follow-ups after a skill has run on the PR need no new run until they change as many lines
// as the commits it saw, half the PR: a significant part of it (Will, 2026-10-24, after #366's
// review fixes ran four rounds under a fixed 40 lines; 2026-10-18, each round cost a whole one).

// A picture (a skin, a screenshot) has no lines to review (Will, 2026-10-18, after PR #275
// ran both skills on one .webp). Any other binary file can't be read, so it is never small.
const PICTURE = /\.(?:webp|png|jpe?g|gif|avif|ico)\}?$/i;

/* The lines a commit's `git show --numstat` adds and removes, pictures left out: null when it
   changes nothing but pictures, Infinity when it changes another binary file. */
export function linesChanged(numstat) {
  const all = numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
  const files = all.filter(([added, , path]) => !(added === "-" && PICTURE.test(path)));
  // a merge commit shows no files, and is no picture
  if (all.length && !files.length) return null;
  return files.reduce(
    (sum, [added, removed]) =>
      added === "-" ? Infinity : sum + (Number(added) || 0) + (Number(removed) || 0),
    0,
  );
}

/* Each skill's commits that no run of it has seen: a run on a commit sees it and every
   commit before it, and once it has run on the PR, later commits pass too while they change
   fewer lines than the commits it saw (a binary file it saw counts none). A commit of only pictures needs no run. `records`
   are { skill, sha }, `isAncestor(a, b)` is git's, `linesOf(sha)` is linesChanged's. */
export function unreviewed(commits, records, isAncestor, linesOf) {
  const linesIn = new Map(commits.map((c) => [c, linesOf(c)]));
  const reviewable = commits.filter((c) => linesIn.get(c) !== null);
  return Object.fromEntries(
    SKILLS.map((skill) => {
      const seen = records.filter((r) => r.skill === skill).map((r) => r.sha);
      const sees = (c) => seen.some((s) => isAncestor(c, s));
      const missing = reviewable.filter((c) => !sees(c));
      const sum = (cs) => cs.reduce((n, c) => n + linesIn.get(c), 0);
      const seenLines = sum(reviewable.filter(sees).filter((c) => linesIn.get(c) !== Infinity));
      // a run that saw only pictures has reviewed nothing yet
      const followUp = seenLines > 0 && sum(missing) < seenLines;
      return [skill, followUp ? [] : missing];
    }),
  );
}

/* what the gate asks for when a PR isn't reviewed to its head. The range, not the bare SHA:
   the built-in code-review reads a lone commit as that one commit (PR #334's retro) */
export const reviewAsk = (since) =>
  `Call the Skill tool for 'code-review' with args \`${since}..HEAD\` (every commit since ${since}), ` +
  "then for 'codebase-design', on the PR's head in this clone, fix what they find, push, and try again.";
