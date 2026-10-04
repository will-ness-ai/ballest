// Copies the static files from the repo root into public/, so Next serves them as GitHub
// Pages did: the icons, the Circuit screenshots, the JSON the collector still publishes
// (until phase 5 of docs/nextjs-migration.md), and the two pages outside the app. The
// site itself is app/. SITE is everything that gets published:
// a new site file goes here or it 404s in production, and web/vercel.json's
// ignoreCommand lists the same paths, data/ aside: a refresh revalidates the site's reads
// rather than deploying. public/ is generated, so none of it is committed; the root files
// stay the ones to edit.
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pub = fileURLToPath(new URL("../public/", import.meta.url));

const SITE = [
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
