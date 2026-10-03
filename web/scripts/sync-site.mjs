// Copies the static site from the repo root into public/, so Next serves the page
// and its data exactly as GitHub Pages does today. The list is deploy.yml's `cp`
// line: a new site file goes in both until Pages is retired. public/ is generated,
// so none of it is committed; the root files stay the ones to edit.
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pub = fileURLToPath(new URL("../public/", import.meta.url));

const SITE = [
  "index.html",
  "favicon.ico",
  "favicon.svg",
  "apple-touch-icon.png",
  "og.png",
  "data",
  "circuit",
  "leth",
  "multiballs",
];

rmSync(pub, { recursive: true, force: true });
mkdirSync(pub);
for (const f of SITE) cpSync(join(root, f), join(pub, f), { recursive: true });
console.log(`synced ${SITE.length} site entries into public/`);
