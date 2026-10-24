// Which catalogue pages a branch's changes can reach, so `qa check` draws those and not all
// 176 views (13 minutes from a cloud session). A page reaches what its page file and the
// layouts above it import, file by file. A changed site file no page imports (an API
// route, the proxy, the database, a picture) can show anywhere, so it draws everything;
// docs, tests, scripts and the other packages draw nothing.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { IDS, PAGES } from "./catalogue.mjs";

/* changed files that never change a drawn page */
const UNDRAWN = [
  /\.md$/,
  /^docs\//,
  /^tools\//,
  /^discord-bot\//,
  /^prefabs\//,
  /^leth\//,
  /^multiballs\//,
  /^\.github\//,
  /^\.claude\//,
  /^\.githooks\//,
  /^web\/test\//,
  /^web\/scripts\//,
  /^web\/db\/seed\//,
  /^web\/eslint\//,
];
const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", ".css", "/index.ts", "/index.tsx"];
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|@import\s+)["']([^"']+)["']/g;

/* a page file's route as a pattern: [x] one segment, [...x] one or more, [[...x]] any */
function routeOf(file) {
  const parts = dirname(file).split("/").slice(2); // after web/app
  const re = parts
    .filter((p) => !/^\(.*\)$/.test(p))
    .map((p) =>
      /^\[\[\.\.\./.test(p)
        ? "(?:/[^/]+)*"
        : /^\[\.\.\./.test(p)
          ? "(?:/[^/]+)+"
          : /^\[/.test(p)
            ? "/[^/]+"
            : "/" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${re}/?$`);
}

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, found);
    else found.push(p);
  }
  return found;
}

/**
 * The catalogue pages `changed` (paths from the repo's root) can reach: `all` names the
 * first file that draws everything, `pages` each reached page with a file that reaches it,
 * and `routes` the page files reached that no catalogue row draws.
 * @param {ReadonlyArray<string>} changed
 * @param {string} root the repo's root
 */
export function reach(changed, root) {
  const app = join(root, "web/app");
  const pageFiles = walk(app)
    .filter((f) => /\/page\.(tsx|ts|jsx|js)$/.test(f))
    .map((f) => relative(root, f));
  const layoutsOf = (file) => {
    const found = [];
    for (let d = dirname(file); d.startsWith("web/app"); d = dirname(d))
      for (const ext of [".tsx", ".ts"])
        if (existsSync(join(root, d, "layout" + ext))) found.push(join(d, "layout" + ext));
    return found;
  };
  /* every file a page draws from, followed through relative imports */
  const reachedFrom = new Map();
  const closure = (entries) => {
    const seen = new Set();
    const todo = [...entries];
    while (todo.length) {
      const file = todo.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(join(root, file), "utf8");
      for (const [, spec] of text.matchAll(IMPORT)) {
        if (!spec.startsWith(".")) continue;
        const base = join(dirname(file), spec);
        const hit = EXTENSIONS.map((e) => base + e).find(
          (p) => existsSync(join(root, p)) && statSync(join(root, p)).isFile(),
        );
        if (hit) todo.push(hit);
      }
    }
    return seen;
  };
  const filesOf = (entries) => {
    const key = entries.join("\n");
    if (!reachedFrom.has(key)) reachedFrom.set(key, closure(entries));
    return reachedFrom.get(key);
  };
  /* a catalogue page's page file: a static segment wins over a dynamic one */
  const fileOfPage = (page) => {
    const path = page.path.replace(/\{(\w+)\}/g, (_, k) => IDS.real[k] ?? "x");
    const hits = pageFiles.filter((f) => routeOf(f).test(path));
    hits.sort((a, b) => (a.match(/\[/g) ?? []).length - (b.match(/\[/g) ?? []).length);
    return hits[0] ?? null;
  };
  const drawn = PAGES.map((p) => {
    const file = fileOfPage(p);
    /* a path no page file serves (the 404) draws the root layout alone */
    return {
      name: p.name,
      files: filesOf(file ? [file, ...layoutsOf(file)] : layoutsOf("web/app/x")),
    };
  });
  const catalogued = new Set(PAGES.map(fileOfPage).filter(Boolean));
  const uncatalogued = pageFiles
    .filter((f) => !catalogued.has(f))
    .map((f) => ({ file: f, files: filesOf([f, ...layoutsOf(f)]) }));

  const pages = [];
  const routes = new Set();
  for (const file of changed) {
    if (UNDRAWN.some((re) => re.test(file))) continue;
    const by = drawn.filter((d) => d.files.has(file));
    const others = uncatalogued.filter((u) => u.files.has(file));
    if (by.length === drawn.length || (!by.length && !others.length))
      return { all: file, pages: [], routes: [] };
    for (const d of by)
      if (!pages.some((p) => p.name === d.name)) pages.push({ name: d.name, via: file });
    for (const u of others) routes.add(u.file);
  }
  pages.sort(
    (a, b) => PAGES.findIndex((p) => p.name === a.name) - PAGES.findIndex((p) => p.name === b.name),
  );
  return { all: null, pages, routes: [...routes].sort() };
}

/* the files this branch changes against main: its commits, the working tree, new files; a
   deleted file is left out, as whatever imported it changed too */
export function changedFiles(root) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  const base = git("merge-base", "origin/main", "HEAD").trim();
  const lines =
    git("diff", "--name-only", "--diff-filter=d", base) +
    git("ls-files", "--others", "--exclude-standard");
  return [...new Set(lines.split("\n").filter(Boolean))];
}
