// Where a local run finds its secrets: the main checkout's .env (the "Multiballs (dev)" app on
// the test server), from that checkout or from any worktree of it.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** The .env file local runs read, unless MULTIBALLS_ENV already names one. */
export const devEnvFile = (): string => {
  const set = process.env.MULTIBALLS_ENV;
  if (set !== undefined) return set;
  if (existsSync(".env")) return ".env";
  // A worktree: the secrets live in the main checkout, next to the shared .git directory.
  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return join(dirname(gitDir), "discord-bot", ".env");
};
