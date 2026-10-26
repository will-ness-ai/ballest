// What `pnpm --silent pr wait` and `pr land` decide (scripts/pr.mjs does the fetching): what a
// PR's head CI says, and what landing the PR does next. For agents; follows the agent-tools
// skill. Tested in test/pr-land.test.ts.
import { notGreen } from "./why.mjs";

const PREVIEW = "vercel preview";
/* a GitHub deployment status's states, Vercel's preview included */
const PREVIEW_RED = new Set(["error", "failure"]);
const PREVIEW_RUNNING = new Set(["pending", "queued", "in_progress"]);

const unique = (names) => [...new Set(names)];

/**
 * A head's CI from its check runs ({ name, status, conclusion }) and its preview's latest
 * deployment status ({ state }, or nothing when Vercel made none): { state: "none" } before a
 * check starts, "red" with the names that didn't pass (even while others run), "running" with
 * the names still going, or "green" with how many checks passed.
 */
export function ciState(runs, preview) {
  const red = runs.filter(notGreen).map((r) => r.name);
  if (preview && PREVIEW_RED.has(preview.state)) red.push(PREVIEW);
  if (red.length) return { state: "red", names: unique(red) };
  const running = runs.filter((r) => r.status !== "completed").map((r) => r.name);
  if (preview && PREVIEW_RUNNING.has(preview.state)) running.push(PREVIEW);
  if (running.length) return { state: "running", names: unique(running) };
  if (!runs.length) return { state: "none" };
  return { state: "green", checks: runs.length };
}

/**
 * Landing's next move for a PR (as `pulls/<n>` gives it), `behind` commits behind its base, with
 * its head's CI from ciState: "done" once merged, "stop" with why on what only a fix clears,
 * "update" to bring the base in, "wait" for CI, "ready" to mark a draft ready, then "merge".
 */
export function landStep(pr, behind, ci) {
  if (pr.merged) return { do: "done" };
  if (pr.state !== "open") return { do: "stop", why: "closed unmerged" };
  if (pr.mergeable_state === "dirty")
    return { do: "stop", why: `conflicts with ${pr.base?.ref ?? "main"}` };
  if (behind > 0) return { do: "update" };
  if (ci.state === "red") return { do: "stop", why: `red: ${ci.names.join(", ")}` };
  if (ci.state !== "green") return { do: "wait" };
  return { do: pr.draft ? "ready" : "merge" };
}
