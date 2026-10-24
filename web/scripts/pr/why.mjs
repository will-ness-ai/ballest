// `pnpm --silent pr why`'s report, from check runs already fetched (scripts/pr.mjs fetches
// them): each failed check of a PR's head, with its failed steps and its failure and notice
// annotations, and nothing else. For agents; follows the agent-tools skill.

/* the conclusions that make a check red */
export const RED = new Set(["failure", "cancelled", "timed_out", "startup_failure"]);
const LEVELS = new Set(["failure", "notice"]);
// the runner's own notices on every job, which never say why one failed
const NOISE = [/^Node\.js 20 is deprecated/, /ubuntu-latest label will migrate/];
const CUT = 1500;

/* an annotation worth reading: a failure or a notice, not the runner's boilerplate */
export const kept = (a) =>
  LEVELS.has(a.annotation_level) && !NOISE.some((re) => re.test(a.message));

const cut = (text, full) =>
  full || text.length <= CUT
    ? text
    : `${text.slice(0, CUT)}… (truncated, ${String(text.length)} chars total; use --full)`;

const failedSteps = (run) => (run.steps ?? []).filter((s) => RED.has(s.conclusion));

/* one check's block under its name: its failed steps, then its annotations */
function block(run, full) {
  const lines = failedSteps(run).map((s) => `step: ${s.name}`);
  if (!run.steps) lines.push(`details: ${run.detailsUrl}`);
  for (const a of (run.annotations ?? []).filter(kept)) {
    const label = a.title ? `${a.annotation_level} (${a.title})` : a.annotation_level;
    const [first, ...rest] = cut(a.message.trim(), full).split("\n");
    lines.push(`${label}: ${first}`, ...rest.map((l) => `  ${l}`));
  }
  return lines.map((l) => `  ${l}`);
}

/**
 * The report for head `sha` from its check runs ({ name, status, conclusion, detailsUrl,
 * steps: the Actions job's steps, or undefined for another app's check, annotations }).
 * A check red at the same steps on both the push and the pull_request event prints once,
 * from its first run (GitHub lists the newest first): the two differ only in timings.
 */
export function whyReport(sha, runs, { full = false } = {}) {
  const out = [`head: ${sha}`];
  const seen = new Map();
  for (const run of runs.filter((r) => RED.has(r.conclusion))) {
    const key = [run.name, run.conclusion, ...failedSteps(run).map((s) => s.name)].join("\n");
    const prior = seen.get(key);
    if (prior) prior.count += 1;
    else seen.set(key, { run, count: 1 });
  }
  for (const { run, count } of seen.values()) {
    const times = count > 1 ? ` (${String(count)} runs)` : "";
    out.push(`${run.name}: ${run.conclusion}${times}`, ...block(run, full));
  }
  const running = [...new Set(runs.filter((r) => r.status !== "completed").map((r) => r.name))];
  if (running.length) out.push(`still running: ${running.join(", ")}`);
  else if (!runs.length) out.push("no checks yet");
  else if (!seen.size) out.push("all green");
  return out.join("\n");
}
