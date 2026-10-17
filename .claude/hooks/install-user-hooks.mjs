// Copies this repo's review-gate hooks (.claude/settings.json) into the user settings file
// named on the command line, with the repo's absolute path in place of $CLAUDE_PROJECT_DIR,
// for sessions that start outside the repo (session-start.sh). Other hooks are kept, and
// running it again replaces its own entries rather than adding more.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const file = process.argv[2];
const ours = JSON.parse(readFileSync(new URL("../settings.json", import.meta.url), "utf8")).hooks;
const settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
settings.hooks ??= {};
for (const event of ["PreToolUse", "PostToolUse"]) {
  const kept = (settings.hooks[event] ?? []).filter(
    (h) => !JSON.stringify(h).includes("review-gate"),
  );
  const gate = JSON.parse(JSON.stringify(ours[event]).replaceAll("$CLAUDE_PROJECT_DIR", repo));
  settings.hooks[event] = [...kept, ...gate];
}
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
