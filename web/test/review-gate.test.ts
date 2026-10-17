import { describe, expect, test } from "vitest";

import { mergeTarget, skillName, unreviewed } from "../../.claude/hooks/review-gate-rules.mjs";

describe("mergeTarget", () => {
  const bash = (command: string) => mergeTarget("Bash", { command });

  test("finds a merge or a mark-ready in gh commands", () => {
    expect(bash("gh pr merge 246 --squash")).toEqual({ repo: null, number: 246 });
    expect(bash("gh pr ready 12")).toEqual({ repo: null, number: 12 });
    expect(bash("cd ballest && gh pr merge --squash")).toEqual({ repo: null, number: null });
    expect(bash("gh pr merge -R will-ness-ai/ballest 7 --squash")).toEqual({
      repo: "will-ness-ai/ballest",
      number: 7,
    });
  });

  test("finds the REST routes that merge or mark ready", () => {
    expect(
      bash("gh api -X PUT repos/will-ness-ai/ballest/pulls/246/merge -f merge_method=squash"),
    ).toEqual({
      repo: "will-ness-ai/ballest",
      number: 246,
    });
    expect(bash("gh api -X POST repos/will-ness-ai/ballest/pulls/9/ccr/ready_for_review")).toEqual({
      repo: "will-ness-ai/ballest",
      number: 9,
    });
    expect(bash("gh api -X PUT repos/o/r/pulls/3/ccr/auto_merge")).toEqual({
      repo: "o/r",
      number: 3,
    });
  });

  test("leaves every other command alone", () => {
    expect(bash("gh pr view 246")).toBeNull();
    expect(bash("gh api repos/o/r/pulls/246/commits")).toBeNull();
    expect(bash("git merge origin/main")).toBeNull();
    expect(bash("echo gh pr merge")).toBeNull();
  });

  test("reads the GitHub tools", () => {
    expect(
      mergeTarget("mcp__github__merge_pull_request", { owner: "o", repo: "r", pullNumber: 5 }),
    ).toEqual({ repo: "o/r", number: 5 });
    expect(
      mergeTarget("mcp__github__update_pull_request", {
        owner: "o",
        repo: "r",
        pullNumber: 5,
        draft: false,
      }),
    ).toEqual({ repo: "o/r", number: 5 });
    expect(
      mergeTarget("mcp__github__update_pull_request", {
        owner: "o",
        repo: "r",
        pullNumber: 5,
        title: "x",
      }),
    ).toBeNull();
  });
});

test("a skill's name drops its source", () => {
  expect(skillName("code-review")).toBe("code-review");
  expect(skillName("projectSettings:code-review")).toBe("code-review");
});

describe("unreviewed", () => {
  // a line of history: a <- b <- c
  const order = ["a", "b", "c"];
  const isAncestor = (x: string, y: string) => order.indexOf(x) <= order.indexOf(y);

  test("a commit is reviewed once both skills have run on it or a later commit", () => {
    const records = [
      { skill: "code-review", sha: "c" },
      { skill: "codebase-design", sha: "b" },
    ];
    expect(unreviewed(["a", "b", "c"], records, isAncestor)).toEqual({
      "code-review": [],
      "codebase-design": ["c"],
    });
  });

  test("with no records every commit is unreviewed", () => {
    expect(unreviewed(["a"], [], isAncestor)).toEqual({
      "code-review": ["a"],
      "codebase-design": ["a"],
    });
  });
});
