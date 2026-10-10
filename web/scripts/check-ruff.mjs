// Fails `pnpm check` up front when the Ruff on PATH isn't the one CI pins (check.yml):
// a newer Ruff reports rules main doesn't follow, and those read like real errors
// (docs/linting.md).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../../.github/workflows/check.yml", import.meta.url),
  "utf8",
);
const want = workflow.match(/ruff==([\d.]+)/)?.[1];
let have = "none";
try {
  have = execFileSync("ruff", ["--version"], { encoding: "utf8" })
    .trim()
    .replace(/^ruff /, "");
} catch {
  // not installed: reported below
}
if (have !== want) {
  console.error(
    `Ruff ${have} is on PATH; CI pins ${want}. Install that one first: ` +
      `uv tool install --force ruff@${want} (or pip install ruff==${want}).`,
  );
  process.exit(1);
}
