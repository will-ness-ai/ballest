// Write the Prefab file a Generator makes, for spawn.py: its defaults with any changes given as
// JSON. Run with web's tsx from the repo root:
//
//   web/node_modules/.bin/tsx .claude/skills/prefab-generators/write-prefab.ts <key> '<json>' <out.json>
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [key, change = "{}", out] = process.argv.slice(2);
const { generate, generatorOf } = (await import(
  pathToFileURL(resolve("web/lib/generators/index.ts")).href
)) as typeof import("../../../web/lib/generators");
const g = generatorOf(key ?? "");
if (!g || !out) {
  console.error("usage: write-prefab.ts <key> '<json changes>' <out.json>");
  process.exit(1);
}
const file = generate(g.key, { ...g.defaults, ...(JSON.parse(change) as object) });
if (!file) {
  console.error(`${g.key} made nothing from these values`);
  process.exit(1);
}
writeFileSync(out, JSON.stringify(file, null, "\t"));
console.log(`${out}: ${String(file.items.length)} pieces`);
