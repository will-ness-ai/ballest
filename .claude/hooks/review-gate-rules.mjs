// What the review gate decides, kept apart from git and gh so it can be tested
// (web/test/review-gate.test.ts). review-gate.mjs is the hook that runs it.

export const SKILLS = ["code-review", "codebase-design"];

// a command's start: the line's, or after a separator
const START = String.raw`(?:^|[;&|(]\s*)`;
const GH_PR = new RegExp(START + String.raw`gh\s+pr\s+(?:merge|ready)\b([^;&|]*)`);
const GH_API = new RegExp(
  START +
    String.raw`gh\s+api\b([^;&|]*?)repos/([^/\s]+/[^/\s]+)/pulls/(\d+)/(?:merge|ccr/ready_for_review|ccr/auto_merge)\b([^;&|]*)`,
);

/* The pull request a tool call merges or marks ready, as { repo: "owner/name" | null,
   number | null } (null when gh is to work it out from the checkout), or null for any
   other call. */
export function mergeTarget(tool, input) {
  if (tool === "mcp__github__merge_pull_request")
    return { repo: `${input.owner}/${input.repo}`, number: input.pullNumber };
  if (tool === "mcp__github__update_pull_request")
    return input.draft === false
      ? { repo: `${input.owner}/${input.repo}`, number: input.pullNumber }
      : null;
  if (tool !== "Bash") return null;
  const command = String(input.command ?? "");
  const api = GH_API.exec(command);
  if (api) {
    const flags = api[1] + api[5];
    if (/(?:-X|--method)[\s=]*DELETE/i.test(flags)) return null;
    return { repo: api[2], number: Number(api[3]) };
  }
  const pr = GH_PR.exec(command);
  if (!pr) return null;
  const args = pr[1];
  const repo = /(?:-R|--repo)[\s=]+(\S+)/.exec(args);
  const rest = repo ? args.replace(repo[0], "") : args;
  const number = /\/pull\/(\d+)|(?:^|\s)#?(\d+)(?=\s|$)/.exec(rest);
  return { repo: repo ? repo[1] : null, number: number ? Number(number[1] ?? number[2]) : null };
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
