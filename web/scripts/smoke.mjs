// Requests everything the published pages load from a running build, and the URLs
// whose shape Pages set (docs/nextjs-migration.md), so a file the site needs that
// SITE in sync-site.mjs leaves out fails here rather than 404ing in production.
// Prints only failures and a summary line.
//
//   pnpm build && pnpm start &   then   node scripts/smoke.mjs [base URL]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, posix } from "node:path";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const root = fileURLToPath(new URL("../../", import.meta.url));
const PAGES = ["index.html", "leth/index.html", "multiballs/terms.html", "multiballs/privacy.html"];

// [path, status, Location for a redirect]
const ROUTES = [
  ["/", 200], ["/leth", 301, "/leth/"], ["/leth/", 200],
  ["/multiballs/terms", 200], ["/multiballs/privacy", 200], ["/no-such-page", 404],
];

// Paths a page loads: src/href attributes and quoted data/ or circuit/ strings in its
// script. A string ending in "/" is a prefix the script completes at runtime, so the
// first file under it stands in for the rest.
function refs(page) {
  const html = readFileSync(join(root, page), "utf8");
  const dir = posix.dirname("/" + page);
  const found = new Set();
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) found.add(ref);
  for (const [, ref] of html.matchAll(/["'`]((?:data|circuit)\/[^"'`$\s)]*)/g)) found.add(ref);
  const out = [];
  for (let ref of found) {
    ref = ref.replace(/^https:\/\/ballest\.willness\.dev/, "");
    if (/^([a-z]+:|#|\$\{)/.test(ref) || ref.includes("${")) continue;
    let path = ref.startsWith("/") ? ref : posix.join(dir, ref);
    if (path === "/") continue;    // ROUTES covers the homepage
    if (path.endsWith("/")) {
      const first = readdirSync(join(root, path)).sort().find(f => statSync(join(root, path, f)).isFile());
      if (!first) continue;
      path += first;
    }
    out.push(path);
  }
  return out;
}

const failures = [];
let checked = 0;

for (const [path, status, location] of ROUTES) {
  checked++;
  const res = await fetch(base + path, { redirect: "manual" });
  const loc = res.headers.get("location")?.replace(base, "");
  if (res.status !== status || (location && loc !== location))
    failures.push(`${path}: ${res.status}${loc ? " -> " + loc : ""}, expected ${status}${location ? " -> " + location : ""}`);
}

const home = await (await fetch(base + "/")).arrayBuffer();
if (!Buffer.from(home).equals(readFileSync(join(root, "index.html"))))
  failures.push("/: does not match index.html");

for (const path of new Set(PAGES.flatMap(refs))) {
  checked++;
  const res = await fetch(base + path);
  if (res.status !== 200) { failures.push(`${path}: ${res.status}`); continue; }
  const body = Buffer.from(await res.arrayBuffer());
  if (!body.equals(readFileSync(join(root, path)))) failures.push(`${path}: differs from the repo file`);
}

for (const f of failures) console.log("FAIL " + f);
console.log(`${checked} URLs checked, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
