// Where `pnpm qa` points: a name (prod, preview, local, local:<port>) or any URL, each with
// the ID set its data has (catalogue.mjs). A preview's address and whether it has finished
// building come from GitHub's deployment records, so an agent never digs them out itself.
import { execFileSync } from "node:child_process";

// production's own Vercel address: the same deployment as ballestrecords.com, which a cloud
// session's network policy may not allow
export const PROD = "https://ballest-n3sonlines-projects.vercel.app";
const REPO = "will-ness-ai/ballest";

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};
const gh = (path) => {
  const out = sh("gh", ["api", path]);
  return out ? JSON.parse(out) : null;
};

/* the newest of the branch's commits Vercel has deployed: its URL, state and commit, and
   whether it trails HEAD (Vercel records deployments by commit, not by branch) */
export function preview(branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "") {
  // Vercel's own rule, for when GitHub can't be asked: lowercased, "/" as "-"; a label over
  // 63 characters is shortened with a hash, which only the deployment record knows
  const guess = `https://ballest-git-${branch.toLowerCase().replaceAll("/", "-")}-n3sonlines-projects.vercel.app`;
  const commits = (sh("git", ["rev-list", "-n", "30", "HEAD"]) ?? "").split("\n");
  const deps = gh(`repos/${REPO}/deployments?per_page=100`) ?? [];
  const dep = commits
    .map((sha) => deps.find((d) => d.sha === sha && d.environment.startsWith("Preview")))
    .find(Boolean);
  if (!dep) return { name: "preview", url: guess, ids: "real", branch, state: "not deployed" };
  const [status] = gh(`repos/${REPO}/deployments/${String(dep.id)}/statuses?per_page=1`) ?? [];
  return {
    name: "preview",
    url: status?.environment_url?.replace(/\/$/, "") ?? guess,
    ids: "real",
    branch,
    sha: dep.sha.slice(0, 7),
    behind: dep.sha !== commits[0],
    state: status?.state ?? "pending",
  };
}

export function resolve(spec) {
  if (spec === "prod") return { name: "prod", url: PROD, ids: "real" };
  if (spec === "preview") return preview();
  const local = /^local(?::(\d+))?$/.exec(spec);
  const url = local ? `http://localhost:${local[1] ?? "3000"}` : spec.replace(/\/$/, "");
  if (!/^https?:\/\//.test(url)) return null;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
  return { name: local ? spec : url, url, ids: isLocal ? "stress" : "real" };
}

/* is anything answering on a local port */
export async function up(url) {
  try {
    await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}
