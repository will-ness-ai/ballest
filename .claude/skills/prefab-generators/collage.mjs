// Screenshot the Generators' collage (/prefabs/collage) for each key into one JPEG each, at half
// size, so one read shows a Generator in every variation from three angles.
//
//   node .claude/skills/prefab-generators/collage.mjs <base url> <out dir> <key>[:control,control] ...
//
// e.g. node .claude/skills/prefab-generators/collage.mjs http://localhost:3000 scratch/collage house tower:crown,shape
// Prints each file's path. Run it from the repo root: it loads playwright-core from web/.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const [base, out, ...keys] = process.argv.slice(2);
if (!base || !out || !keys.length) {
  console.error("usage: node collage.mjs <base url> <out dir> <key>[:control,control] ...");
  process.exit(1);
}
const { chromium } = createRequire(resolve("web/package.json"))("playwright-core");
mkdirSync(out, { recursive: true });
/* Will's PC has Chrome and Edge but no Playwright browser; a cloud session has Playwright's,
   at /opt/pw-browsers/chromium when web's playwright-core wants a newer build than the image's */
const browser = await chromium
  .launch({ channel: "chrome" })
  .catch(() => chromium.launch({ channel: "msedge" }))
  .catch(() => chromium.launch())
  .catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
for (const arg of keys) {
  const [key, only] = arg.split(":");
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 0.5 });
  await page.goto(`${base}/prefabs/collage?g=${key}${only ? `&only=${only}` : ""}`);
  await page.waitForSelector(".gen-collage[data-ready]", { timeout: 180000 });
  const file = `${out}/${key}${only ? "-" + only.replace(/,/g, "-") : ""}.jpg`;
  await page.locator(".gen-collage").screenshot({ path: file, type: "jpeg", quality: 72 });
  await page.close();
  console.log(file);
}
await browser.close();
