// The pre-push hook's check that a push doesn't stack new commits on a pull request that is
// already merged: GitHub's merged event can reach a session long after the merge, and the
// commits pushed meanwhile never reach main (#237). Restarting the branch from main and
// pushing that is fine: the repo squash-merges, so the old head is in that push but not in
// main. (After a merge commit it is in both, and a new PR from the branch works anyway.)
// It skips quietly when gh can't answer.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { repoSlug } from "../.claude/hooks/review-gate-rules.mjs";

const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const tries = (f) => {
  try {
    return f();
  } catch {
    return null;
  }
};

const isAncestor = (a, b) =>
  tries(() => run("git", ["merge-base", "--is-ancestor", a, b])) !== null;

const slug = tries(() => repoSlug(run("git", ["remote", "get-url", "origin"])));
const stacked = readFileSync(0, "utf8")
  .split("\n")
  .map((line) => line.split(" "))
  .filter(([, sha, ref]) => sha && !/^0+$/.test(sha) && ref?.startsWith("refs/heads/"))
  .flatMap(([, sha, ref]) => {
    const branch = ref.slice("refs/heads/".length);
    const merged = tries(() =>
      JSON.parse(
        run("gh", [
          "api",
          `repos/${slug}/pulls?head=${slug.split("/")[0]}:${branch}&state=closed`,
          "--jq",
          "[.[] | select(.merged_at) | {number, sha: .head.sha}]",
        ]),
      ),
    );
    return (merged ?? [])
      .filter((pr) => isAncestor(pr.sha, sha) && !isAncestor(pr.sha, "origin/main"))
      .map((pr) => ({ ...pr, branch }));
  });

if (slug && stacked.length) {
  for (const { number, branch } of stacked)
    console.error(
      `error: PR #${String(number)} from ${branch} is already merged, so these commits would never reach main. ` +
        `Restart the branch from main (git fetch origin main && git checkout -B ${branch} origin/main), ` +
        "bring your new commits over, and open a new PR (docs/agents/feature-workflow.md, step 7).",
    );
  process.exit(1);
}
