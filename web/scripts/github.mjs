// This checkout's GitHub repo, for the scripts and git hooks that call `gh api` on it
// (scripts/pr.mjs, .githooks/merged-pr.mjs).
import { execFileSync } from "node:child_process";

/* "owner/name", lower case, from gh's -R forms or a remote URL (GitHub's or a proxy's) */
export function repoSlug(text) {
  const parts = String(text)
    .toLowerCase()
    .replace(/\.git\/?$|\/$/, "")
    .split(/[/:]/);
  return parts.slice(-2).join("/");
}

/* the slug of origin in the checkout `cwd` is in; throws when git can't say */
export const originSlug = (cwd) =>
  repoSlug(
    execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim(),
  );
