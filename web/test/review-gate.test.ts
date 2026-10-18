import { describe, expect, test } from "vitest";

import {
  FOLLOW_UP_LINES,
  mergeTargets,
  repoSlug,
  skillName,
  unreviewed,
} from "../../.claude/hooks/review-gate-rules.mjs";

describe("mergeTargets", () => {
  // which PRs; whether each merge squashes is under "unsquashed merges"
  // toEqual skips an undefined field
  const targets = (tool: string, input: object) =>
    (mergeTargets(tool, input) as Array<object>).map((t) => ({ ...t, unsquashed: undefined }));
  const bash = (command: string): unknown => targets("Bash", { command });
  const pr = (number: number | null, more = {}) => [{ repo: null, number, ...more }];

  test("finds gh's merges and mark-readies", () => {
    expect(bash("gh pr merge 246 --squash")).toEqual(pr(246));
    expect(bash("gh pr ready #12")).toEqual(pr(12));
    expect(bash("gh pr merge --squash --body 'fixes 12 things'")).toEqual(pr(null));
    expect(bash('gh pr merge --body "a; b" 5')).toEqual(pr(5));
    expect(bash("gh pr merge claude/x --squash")).toEqual(pr(null, { branch: "claude/x" }));
    expect(bash('gh pr merge "246" --squash')).toEqual(pr(246));
    expect(bash('gh pr merge "$PR" --squash')).toEqual(pr(null, { branch: "$PR" }));
    expect(bash("export GH_REPO=o/r; gh pr merge 3")).toEqual([{ repo: "o/r", number: 3 }]);
    // a GH_REPO in front of an earlier call was that call's only
    expect(bash("GH_REPO=o/r gh pr view 3; gh pr merge 4")).toEqual(pr(4));
    expect(bash("gh pr merge https://github.com/o/r/pull/8")).toEqual([{ repo: "o/r", number: 8 }]);
    expect(bash("gh pr merge -R will-ness-ai/ballest 7")).toEqual([
      { repo: "will-ness-ai/ballest", number: 7 },
    ]);
    expect(bash("gh -R o/r pr merge 5")).toEqual([{ repo: "o/r", number: 5 }]);
  });

  test("finds them behind prefixes, wrappers and later lines", () => {
    expect(bash("  gh pr merge 5")).toEqual(pr(5));
    expect(bash("GH_TOKEN=x timeout 60 gh pr merge 5")).toEqual(pr(5));
    expect(bash("GH_REPO=o/r gh pr merge 5")).toEqual([{ repo: "o/r", number: 5 }]);
    expect(bash("bash -c 'gh pr merge 5'")).toEqual(pr(5));
    expect(bash("if true; then gh pr merge 5; fi")).toEqual(pr(5));
    expect(bash("gh pr merge 3 -R o/x; gh pr merge 5")).toEqual([
      { repo: "o/x", number: 3 },
      { repo: null, number: 5 },
    ]);
  });

  test("notes a cd into another checkout", () => {
    expect(bash("cd /w/ballest\ngh pr merge 5")).toEqual(pr(5, { cd: "/w/ballest" }));
    expect(bash('cd "../plugins" && gh pr merge 5')).toEqual(pr(5, { cd: "../plugins" }));
    expect(bash('bash -c "cd /w/wt && gh pr merge"')).toEqual(pr(null, { cd: "/w/wt" }));
    expect(bash("if x; then cd /w/wt; fi; gh pr merge 5")).toEqual(pr(5, { cd: "/w/wt" }));
    // each relative cd moves from the last
    expect(bash("cd web && pnpm test && cd .. && gh pr merge 5")).toEqual(pr(5, { cd: "web/.." }));
    expect(bash("cd a && cd /w/b && cd c && gh pr merge 5")).toEqual(pr(5, { cd: "/w/b/c" }));
    expect(bash("cd /w/o && git pull && cd - && gh pr merge 5")).toEqual(pr(5));
    expect(bash("cd /a && cd /b && cd - && gh pr merge 5")).toEqual(pr(5, { cd: "/a" }));
  });

  test("finds the REST routes that write", () => {
    expect(bash("gh api -X PUT repos/o/r/pulls/246/merge -f merge_method=squash")).toEqual([
      { repo: "o/r", number: 246 },
    ]);
    expect(bash("gh api repos/o/r/pulls/9/ccr/ready_for_review -f x=1")).toEqual([
      { repo: "o/r", number: 9 },
    ]);
    expect(bash("curl -X PUT https://api.github.com/repos/o/r/pulls/4/merge")).toEqual([
      { repo: "o/r", number: 4 },
    ]);
    // gh fills these in from the checkout
    expect(bash("gh api -X PUT repos/{owner}/{repo}/pulls/5/merge")).toEqual(pr(5));
    expect(bash("gh api -X PUT repos/:owner/:repo/pulls/5/merge")).toEqual(pr(5));
    expect(bash('gh api -X PUT -f commit_title="Fix; tidy" repos/o/r/pulls/7/merge')).toEqual([
      { repo: "o/r", number: 7 },
    ]);
  });

  test("can't name the PR a GraphQL mutation merges", () => {
    expect(
      bash("gh api graphql -f query='mutation { mergePullRequest(input: {}) { x } }'"),
    ).toEqual([{ opaque: true }]);
    expect(bash("cd /w/p && gh api graphql -f query='mutation { mergePullRequest }'")).toEqual([
      { opaque: true, cd: "/w/p" },
    ]);
  });

  test("leaves every other command alone", () => {
    for (const command of [
      "gh pr view 246",
      "gh pr ready 12 --undo",
      "gh pr merge 5 --disable-auto",
      "gh api repos/o/r/pulls/246/commits",
      "gh api repos/o/r/pulls/4/merge",
      "curl https://api.github.com/repos/o/r/pulls/4/merge",
      "gh api -X DELETE repos/o/r/pulls/3/ccr/auto_merge",
      "git merge origin/main",
    ])
      expect(bash(command), command).toEqual([]);
  });

  test("reads the GitHub tools", () => {
    const at = { owner: "o", repo: "r", pullNumber: 5 };
    const five = [{ repo: "o/r", number: 5 }];
    expect(targets("mcp__github__merge_pull_request", at)).toEqual(five);
    expect(targets("mcp__github__enable_pr_auto_merge", at)).toEqual(five);
    expect(targets("mcp__github__update_pull_request", { ...at, draft: false })).toEqual(five);
    expect(targets("mcp__github__update_pull_request", { ...at, title: "x" })).toEqual([]);
  });
});

test("a repo is named the way gh and GitHub's URLs do, in any case", () => {
  expect(repoSlug("Will-Ness-AI/Ballest")).toBe("will-ness-ai/ballest");
  expect(repoSlug("github.com/will-ness-ai/ballest")).toBe("will-ness-ai/ballest");
  expect(repoSlug("https://github.com/will-ness-ai/ballest.git")).toBe("will-ness-ai/ballest");
  expect(repoSlug("http://local_proxy@127.0.0.1:1/git/will-ness-ai/ballest")).toBe(
    "will-ness-ai/ballest",
  );
  expect(repoSlug("git@github.com:will-ness-ai/ballest.git")).toBe("will-ness-ai/ballest");
});

test("a skill's name drops its source", () => {
  expect(skillName("code-review")).toBe("code-review");
  expect(skillName("projectSettings:code-review")).toBe("code-review");
});

describe("unsquashed merges", () => {
  const unsquashed = (tool: string, input: object): boolean =>
    (mergeTargets(tool, input) as Array<{ unsquashed?: boolean }>).some((t) => t.unsquashed);
  const bash = (command: string): boolean => unsquashed("Bash", { command });

  test("finds merges that don't squash", () => {
    expect(bash("gh pr merge 5")).toBe(true);
    expect(bash("gh pr merge 5 --merge")).toBe(true);
    expect(bash("gh pr merge -dm 5")).toBe(true);
    expect(bash("gh pr merge --squash 5; gh pr merge -R o/x 6")).toBe(true);
    expect(bash("gh api -X PUT repos/o/r/pulls/5/merge -f merge_method=merge")).toBe(true);
    expect(bash("gh api -X PUT repos/o/r/pulls/5/merge")).toBe(true);
    expect(unsquashed("mcp__github__merge_pull_request", { pullNumber: 5 })).toBe(true);
    expect(unsquashed("mcp__github__merge_pull_request", { merge_method: "rebase" })).toBe(true);
    expect(unsquashed("mcp__github__enable_pr_auto_merge", { mergeMethod: "MERGE" })).toBe(true);
    expect(
      bash(
        `curl -X PUT -d '{"merge_method":"rebase"}' https://api.github.com/repos/o/r/pulls/5/merge`,
      ),
    ).toBe(true);
  });

  test("lets squashes, mark-readies and other calls through", () => {
    expect(bash("gh pr merge 5 --squash")).toBe(false);
    expect(bash("gh pr merge --auto -s 5")).toBe(false);
    expect(bash("gh api -X PUT repos/o/r/pulls/5/merge -f merge_method=squash")).toBe(false);
    expect(bash("gh api -X PUT repos/o/r/pulls/5/merge -f 'merge_method=squash'")).toBe(false);
    expect(bash("gh pr merge -sd 5")).toBe(false);
    expect(bash("gh pr merge 5 --disable-auto")).toBe(false);
    expect(bash("gh api repos/o/r/pulls/5/merge")).toBe(false);
    expect(
      bash(
        `curl -X PUT -d '{"merge_method":"squash"}' https://api.github.com/repos/o/r/pulls/5/merge`,
      ),
    ).toBe(false);
    expect(unsquashed("mcp__github__enable_pr_auto_merge", { mergeMethod: "SQUASH" })).toBe(false);
    expect(bash("gh pr ready 5")).toBe(false);
    expect(bash("gh pr view 5")).toBe(false);
    expect(unsquashed("mcp__github__merge_pull_request", { merge_method: "squash" })).toBe(false);
    expect(unsquashed("mcp__github__update_pull_request", { draft: false })).toBe(false);
    expect(
      bash(`curl -X PUT -d '{"merge_method": "squash"}' https://x/repos/o/r/pulls/5/merge`),
    ).toBe(false);
    expect(
      bash(`curl -X PUT -d "{\\"merge_method\\":\\"squash\\"}" https://x/repos/o/r/pulls/5/merge`),
    ).toBe(false);
  });
});

describe("unreviewed", () => {
  // a line of history: a <- b <- c
  const order = ["a", "b", "c"];
  const isAncestor = (x: string, y: string) => order.indexOf(x) <= order.indexOf(y);
  const big = () => Infinity;

  test("a commit is reviewed once both skills have run on it or a later commit", () => {
    const records = [
      { skill: "code-review", sha: "c" },
      { skill: "codebase-design", sha: "b" },
    ];
    expect(unreviewed(["a", "b", "c"], records, isAncestor, big)).toEqual({
      "code-review": [],
      "codebase-design": ["c"],
    });
  });

  test("a small follow-up after a review needs no new run", () => {
    const records = [
      { skill: "code-review", sha: "a" },
      { skill: "codebase-design", sha: "a" },
    ];
    const small: Record<string, number> = { b: 10, c: FOLLOW_UP_LINES - 11 };
    expect(unreviewed(["a", "b", "c"], records, isAncestor, (c: string) => small[c] ?? 0)).toEqual({
      "code-review": [],
      "codebase-design": [],
    });
    const atLimit: Record<string, number> = { b: 10, c: FOLLOW_UP_LINES - 10 };
    expect(
      unreviewed(["a", "b", "c"], records, isAncestor, (c: string) => atLimit[c] ?? 0),
    ).toEqual({
      "code-review": ["b", "c"],
      "codebase-design": ["b", "c"],
    });
  });

  test("a small PR still needs its first run", () => {
    expect(unreviewed(["a"], [], isAncestor, () => 1)).toEqual({
      "code-review": ["a"],
      "codebase-design": ["a"],
    });
  });

  test("with no records every commit is unreviewed", () => {
    expect(unreviewed(["a"], [], isAncestor, big)).toEqual({
      "code-review": ["a"],
      "codebase-design": ["a"],
    });
  });
});
