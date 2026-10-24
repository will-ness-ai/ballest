import { describe, expect, it } from "vitest";

import { whyReport } from "../scripts/pr/why.mjs";

// `pnpm --silent pr why <n>` (scripts/pr.mjs): why a PR's head is red, from the check runs
// and their jobs and annotations that the REST API gives a cloud session.
const HEAD = "21c97c8c3ec23916a78be4b4108d8456e54c7159";
const NODE20 = {
  annotation_level: "warning",
  title: "",
  message: "Node.js 20 is deprecated. The following actions target Node.js 20 ...",
};
const UBUNTU = {
  annotation_level: "notice",
  title: "",
  message: '"The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026."',
};
const EXIT = {
  annotation_level: "failure",
  title: "",
  message: "Process completed with exit code 1.",
};
const QA = {
  annotation_level: "notice",
  title: "qa check",
  message:
    "checked 306 views\nfaults[1]{kind,where,detail,views}:\n  overlap,span.p3t,2px,home@320",
};
const steps = [
  { name: "Run pnpm build", conclusion: "success" },
  { name: "Smoke-test the build and check its layout", conclusion: "failure" },
  { name: "Post Run actions/setup-node@v4", conclusion: "skipped" },
];
const build = (id: number) => ({
  id,
  name: "build",
  status: "completed",
  conclusion: "failure",
  detailsUrl: `https://github.com/x/job/${String(id)}`,
  steps,
  annotations: [NODE20, EXIT, QA, UBUNTU],
});
const ok = (name: string) => ({ id: 1, name, status: "completed", conclusion: "success" });

describe("pr why", () => {
  it("prints each failed check's failed steps and its failure and notice annotations", () => {
    expect(whyReport(HEAD, [ok("lint"), build(7)])).toBe(
      [
        `head: ${HEAD}`,
        "build: failure",
        "  step: Smoke-test the build and check its layout",
        "  failure: Process completed with exit code 1.",
        "  notice (qa check): checked 306 views",
        "    faults[1]{kind,where,detail,views}:",
        "      overlap,span.p3t,2px,home@320",
      ].join("\n"),
    );
  });

  it("prints a check failed at the same step on both the push and the PR once", () => {
    const again = { ...build(8), annotations: [{ ...QA, message: "checked 306 views in 255s" }] };
    const out = whyReport(HEAD, [build(7), again]).split("\n");
    expect(out[1]).toBe("build: failure (2 runs)");
    expect(out.filter((l) => l.startsWith("build:"))).toHaveLength(1);
    expect(out).toContain("  notice (qa check): checked 306 views");
  });

  it("keeps both runs' annotations, each once", () => {
    const again = { ...build(8), annotations: [EXIT, { ...QA, message: "checked 2 views" }] };
    const out = whyReport(HEAD, [build(7), again]).split("\n");
    expect(out).toContain("  notice (qa check): checked 2 views");
    expect(out.filter((l) => l === "  failure: Process completed with exit code 1.")).toHaveLength(
      1,
    );
  });

  it("names any conclusion but success or skipped, so it never reads as all green", () => {
    for (const conclusion of ["action_required", "stale", "neutral"]) {
      const run = { id: 3, name: "deploy", status: "completed", conclusion, steps: [] };
      expect(whyReport(HEAD, [ok("lint"), run])).toBe(`head: ${HEAD}\ndeploy: ${conclusion}`);
    }
    const skipped = { id: 4, name: "deploy", status: "completed", conclusion: "skipped" };
    expect(whyReport(HEAD, [skipped])).toBe(`head: ${HEAD}\nall green`);
  });

  it("names a cancelled check, and a failed one that isn't an Actions job by its link", () => {
    const vercel = {
      id: 9,
      name: "Vercel",
      status: "completed",
      conclusion: "cancelled",
      detailsUrl: "https://vercel.com/x",
      annotations: [],
    };
    expect(whyReport(HEAD, [vercel])).toBe(
      [`head: ${HEAD}`, "Vercel: cancelled", "  details: https://vercel.com/x"].join("\n"),
    );
  });

  it("cuts a long annotation and says how long it was", () => {
    const long = { annotation_level: "failure", title: "", message: "x".repeat(2000) };
    const out = whyReport(HEAD, [{ ...build(7), annotations: [long] }]);
    expect(out).toContain("… (truncated, 2000 chars total; use --full)");
    expect(whyReport(HEAD, [{ ...build(7), annotations: [long] }], { full: true })).toContain(
      "x".repeat(2000),
    );
  });

  it("says all green, or what is still running, when nothing failed", () => {
    expect(whyReport(HEAD, [ok("lint"), ok("build")])).toBe(`head: ${HEAD}\nall green`);
    const running = { id: 2, name: "build", status: "in_progress", conclusion: null };
    expect(whyReport(HEAD, [ok("lint"), running])).toBe(`head: ${HEAD}\nstill running: build`);
    expect(whyReport(HEAD, [])).toBe(`head: ${HEAD}\nno checks yet`);
  });

  it("adds what is still running after the failures", () => {
    const running = { id: 2, name: "smoke", status: "queued", conclusion: null };
    expect(
      whyReport(HEAD, [build(7), running])
        .split("\n")
        .at(-1),
    ).toBe("still running: smoke");
  });
});
