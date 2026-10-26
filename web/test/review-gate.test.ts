import { describe, expect, test } from "vitest";

import {
  linesChanged,
  loadable,
  refusedSkills,
  mergeTargets,
  repoSlug,
  skillName,
  unreviewed,
} from "../../.claude/hooks/review-gate-rules.mjs";

describe("mergeTargets", () => {
  // which PRs; whether each merge squashes is under "unsquashed merges"
  // these tests are about which PRs; toEqual skips the field once it is undefined
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

  test("finds pnpm pr land, which marks ready and squash-merges", () => {
    expect(bash("pnpm --silent pr land 287")).toEqual(pr(287));
    expect(bash("pnpm pr land 287 --timeout 300")).toEqual(pr(287));
    expect(bash("cd /w/ballest && pnpm -s pr land 9")).toEqual(pr(9, { cd: "/w/ballest" }));
    expect(bash("pnpm --silent pr land --help")).toEqual([]);
    expect(bash("pnpm --silent pr wait 287")).toEqual([]);
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

test("a skill is loadable from the project's or the user's skills, or built in", () => {
  const dirs = ["/repo/.claude/skills", "/root/.claude/skills"];
  const has =
    (...files: Array<string>) =>
    (path: string) =>
      files.includes(path);
  const design = "codebase-design";
  expect(loadable(design, dirs, has(`/root/.claude/skills/${design}/SKILL.md`))).toBe(true);
  expect(loadable(design, dirs, has(`/repo/.claude/skills/${design}/SKILL.md`))).toBe(true);
  // a thread that started outside the repo, before its skills were linked (PR #336)
  expect(loadable(design, dirs, has())).toBe(false);
  // Claude Code has its own /code-review
  expect(loadable("code-review", dirs, has())).toBe(true);
});

describe("a skill this session's Skill tool called unknown", () => {
  /* a transcript's lines: the Skill tool asked for `skill` (id `id`), and its result */
  const asked = (id: string, skill: string) =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill } }] },
    });
  const answered = (id: string, text: string, error = true) =>
    JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: error }],
      },
    });
  const unknown = (id: string, skill: string) =>
    answered(id, `<tool_use_error>Unknown skill: ${skill}</tool_use_error>`);
  const dirs = ["/home/user/.claude/skills"];
  const all = () => true;

  test("isn't loadable, whatever the files say", () => {
    // a project thread whose skills were linked, yet its Skill tool never read them (PR #368)
    const refused = refusedSkills(
      [
        asked("a", "tdd"),
        unknown("a", "tdd"),
        asked("b", "codebase-design"),
        unknown("b", "codebase-design"),
      ].join("\n"),
    );
    expect([...refused].sort()).toEqual(["codebase-design", "tdd"]);
    expect(loadable("codebase-design", dirs, all, refused)).toBe(false);
    expect(loadable("grill-design", dirs, all, refused)).toBe(true);
    expect(refusedSkills("")).toEqual(new Set());
  });

  test("only by the Skill tool's own answer, not text that quotes it", () => {
    const quoted = JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "r", content: "Unknown skill: codebase-design" },
        ],
      },
    });
    expect(refusedSkills([quoted, "Unknown skill: codebase-design"].join("\n"))).toEqual(new Set());
  });

  test("by the bare name the error gives, and not once it has run since", () => {
    const refused = refusedSkills(
      [
        asked("a", "foo:codebase-design"),
        unknown("a", "foo:codebase-design"),
        asked("b", "tdd"),
        unknown("b", "tdd"),
        asked("c", "ballest:tdd"),
        answered("c", "Launching skill: tdd", false),
        asked("d", "/grill-design"),
        unknown("d", "grill-design"),
      ].join("\n"),
    );
    expect(loadable("codebase-design", dirs, all, refused)).toBe(true);
    expect(loadable("tdd", dirs, all, refused)).toBe(true);
    expect(loadable("grill-design", dirs, all, refused)).toBe(false);
  });

  test("the built-in code-review stays loadable", () => {
    const refused = refusedSkills(
      [asked("a", "code-review"), unknown("a", "code-review")].join("\n"),
    );
    expect(loadable("code-review", dirs, () => false, refused)).toBe(true);
  });
});

describe("unsquashed merges", () => {
  const unsquashed = (tool: string, input: object): boolean =>
    (mergeTargets(tool, input) as Array<{ unsquashed?: boolean }>).some((t) => t.unsquashed);
  const bash = (command: string): boolean => unsquashed("Bash", { command });

  test("pnpm pr land always squashes", () => {
    expect(bash("pnpm --silent pr land 287")).toBe(false);
  });

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

  test("follow-ups need no new run until they are half the PR's lines", () => {
    const records = [
      { skill: "code-review", sha: "a" },
      { skill: "codebase-design", sha: "a" },
    ];
    /* a reviewed 300-line commit, then fixes */
    const run = (b: number, c: number) => {
      const lines: Record<string, number> = { a: 300, b, c };
      return unreviewed(["a", "b", "c"], records, isAncestor, (x: string) => lines[x]);
    };
    expect(run(100, 199)).toEqual({ "code-review": [], "codebase-design": [] });
    expect(run(100, 200)).toEqual({ "code-review": ["b", "c"], "codebase-design": ["b", "c"] });
    /* a binary file the run saw makes no follow-up small */
    const binary: Record<string, number> = { a: Infinity, b: 5000, c: 0 };
    expect(unreviewed(["a", "b", "c"], records, isAncestor, (x: string) => binary[x])).toEqual({
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

  test("a commit of only pictures needs no run", () => {
    const pictures = (c: string) => (c === "b" ? null : 1);
    expect(unreviewed(["b"], [], isAncestor, pictures)).toEqual({
      "code-review": [],
      "codebase-design": [],
    });
    expect(unreviewed(["a", "b"], [], isAncestor, pictures)).toEqual({
      "code-review": ["a"],
      "codebase-design": ["a"],
    });
  });

  test("a run that saw only pictures is no run on the PR", () => {
    const pictures = (c: string) => (c === "a" ? null : 5);
    const records = [
      { skill: "code-review", sha: "a" },
      { skill: "codebase-design", sha: "a" },
    ];
    expect(unreviewed(["a", "b"], records, isAncestor, pictures)).toEqual({
      "code-review": ["b"],
      "codebase-design": ["b"],
    });
  });
});

describe("linesChanged", () => {
  test("adds up a commit's added and removed lines", () => {
    expect(linesChanged("3\t1\tweb/a.ts\n2\t0\tdocs/b.md\n")).toBe(6);
    // a merge commit shows no files
    expect(linesChanged("")).toBe(0);
  });

  test("leaves pictures out, and is null when a commit changes nothing else", () => {
    expect(linesChanged("-\t-\tskins/DA_LBall.webp\n")).toBeNull();
    expect(linesChanged("-\t-\tog.png\n-\t-\tskins/{a.webp => b.webp}\n")).toBeNull();
    expect(linesChanged("-\t-\tcircuit/Track 1.webp\n4\t4\tweb/lib/skins.ts\n")).toBe(8);
  });

  test("a picture git reads as text counts its lines", () => {
    expect(linesChanged("12\t3\tfavicon.svg\n")).toBe(15);
  });

  test("any other binary file is too big to skip", () => {
    expect(linesChanged("-\t-\ttools/version.dll\n1\t0\ta.ts\n")).toBe(Infinity);
  });
});
