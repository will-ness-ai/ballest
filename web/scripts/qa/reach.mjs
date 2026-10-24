// Which catalogue pages a branch's changes can reach, so `qa check` draws those and not all
// 176 views (13 minutes from a cloud session). A page reaches what its page file and the
// layouts above it import, file by file. A changed site file no page imports (an API
// route, the proxy, the database, a picture) can show anywhere, so it draws everything;
// docs, tests, tooling and the other packages draw nothing. Paths are the repo's, with `/`
// on every system, as git prints them.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

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
  /* but qa's own drawing (what it draws and how it measures) and what sync-site publishes
     show on every page */
  /^web\/scripts\/(?!qa\/(catalogue|browser|probes|compare|landing|session|targets)\.mjs$|qa\.mjs$|sync-site\.mjs$)/,
  /^web\/db\/seed\//,
  /^web\/eslint\//,
  /^web\/(vitest|drizzle)\.config\.ts$/,
  /^(eslint\.config\.js|ruff\.toml|skills-lock\.json)$/,
  /(^|\/)\.(gitignore|prettierignore|prettierrc[^/]*)$/,
];
const CODE = /\.(ts|tsx|mjs|js|css)$/;
const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", ".css", "/index.ts", "/index.tsx"];
/* the paths a file's relative imports name, from the repo's root, before an extension is
   looked for: ./a/b from web/lib/x.ts is web/lib/a/b */
const specsOf = (file, text) =>
  [...text.matchAll(IMPORT)]
    .map(([, spec]) => spec)
    .filter((spec) => spec.startsWith("."))
    .map((spec) => posix.join(posix.dirname(file), spec).replace(/\/$/, ""));
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|@import\s+)["']([^"']+)["']/g;

/* a page file's route segments, past web/app and any (group) */
const segmentsOf = (file) =>
  posix
    .dirname(file)
    .split("/")
    .slice(2)
    .filter((p) => !/^\(.*\)$/.test(p));
/* how loosely a segment matches, for Next's order: a static one wins, then [x], [...x], [[...x]] */
const looseness = (p) =>
  !p.startsWith("[") ? 0 : p.startsWith("[[") ? 3 : p.startsWith("[...") ? 2 : 1;

/* a page file's route as a pattern: [x] one segment, [...x] one or more, [[...x]] any */
function routeOf(file) {
  const re = segmentsOf(file)
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

/* every file under `dir`, a path from the repo's root */
function walk(root, dir, found = []) {
  for (const name of readdirSync(join(root, dir))) {
    const p = posix.join(dir, name);
    if (statSync(join(root, p)).isDirectory()) walk(root, p, found);
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
  const pageFiles = walk(root, "web/app").filter((f) => /\/page\.(tsx|ts|jsx|js)$/.test(f));
  const isFile = (p) => existsSync(join(root, p)) && statSync(join(root, p)).isFile();
  const layoutsOf = (file) => {
    const found = [];
    for (let d = posix.dirname(file); d.startsWith("web/app"); d = posix.dirname(d))
      for (const ext of [".tsx", ".ts"])
        if (isFile(`${d}/layout${ext}`)) found.push(`${d}/layout${ext}`);
    return found;
  };
  /* the files one file imports by a relative path, each read once */
  const edges = new Map();
  const importsOf = (file) => {
    if (!edges.has(file))
      edges.set(
        file,
        specsOf(file, readFileSync(join(root, file), "utf8"))
          .map((base) => EXTENSIONS.map((e) => base + e).find(isFile))
          .filter(Boolean),
      );
    return edges.get(file);
  };
  /* every file a page draws from */
  const reachedFrom = new Map();
  const closure = (entries) => {
    const seen = new Set();
    const todo = [...entries];
    while (todo.length) {
      const file = todo.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      todo.push(...importsOf(file));
    }
    return seen;
  };
  const filesOf = (entries) => {
    const key = entries.join("\n");
    if (!reachedFrom.has(key)) reachedFrom.set(key, closure(entries));
    return reachedFrom.get(key);
  };
  const routes = pageFiles.map((file) => ({
    file,
    pattern: routeOf(file),
    loose: segmentsOf(file).map(looseness),
  }));
  /* a catalogue page's page file: a static segment wins over a dynamic one */
  const fileOfPage = (page) => {
    const path = page.path.replace(/\{(\w+)\}/g, (_, k) => IDS.real[k] ?? "x");
    const hits = routes.filter((r) => r.pattern.test(path));
    hits.sort((a, b) => {
      for (let i = 0; i < Math.min(a.loose.length, b.loose.length); i++)
        if (a.loose[i] !== b.loose[i]) return a.loose[i] - b.loose[i];
      return b.loose.length - a.loose.length;
    });
    return hits[0]?.file ?? null;
  };
  const drawn = PAGES.map((p) => {
    const file = fileOfPage(p);
    /* a path no page file serves (the 404) draws the root layout alone */
    return {
      name: p.name,
      file,
      files: filesOf(file ? [file, ...layoutsOf(file)] : layoutsOf("web/app/x")),
    };
  });
  const catalogued = new Set(drawn.map((d) => d.file).filter(Boolean));
  const uncatalogued = pageFiles
    .filter((f) => !catalogued.has(f))
    .map((f) => ({ file: f, files: filesOf([f, ...layoutsOf(f)]) }));

  const pages = [];
  const reached = new Set();
  for (const file of changed) {
    if (UNDRAWN.some((re) => re.test(file))) continue;
    const by = drawn.filter((d) => d.files.has(file));
    const others = uncatalogued.filter((u) => u.files.has(file));
    if (by.length === drawn.length || (!by.length && !others.length))
      return { all: file, pages: [], routes: [] };
    for (const d of by)
      if (!pages.some((p) => p.name === d.name)) pages.push({ name: d.name, via: file });
    for (const u of others) reached.add(u.file);
  }
  pages.sort(
    (a, b) => PAGES.findIndex((p) => p.name === a.name) - PAGES.findIndex((p) => p.name === b.name),
  );
  return { all: null, pages, routes: [...reached].sort() };
}

/* the files this branch changes against main: its commits up to `at` (a commit, such as
   the one a preview holds), or else up to the working tree with its new files; a rename as
   its old path and its new, and a deleted file unless a changed file imported it on main,
   as that importer is in the diff already. Throws when git can't find main. */
export function changedFiles(root, { at } = {}) {
  const run = (...args) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe" });
  const git = (...args) =>
    run(...args)
      .split("\n")
      .filter(Boolean);
  const [base] = git("merge-base", "origin/main", at ?? "HEAD");
  const diff = (filter) =>
    git(
      "diff",
      "--name-only",
      "--no-renames",
      `--diff-filter=${filter}`,
      base,
      ...(at ? [at] : []),
    );
  const kept = diff("d");
  const deleted = diff("D");
  /* what the changed code files imported on main, as repo paths without their extension */
  const importedOnMain = new Set();
  if (deleted.length)
    for (const f of kept.filter((k) => CODE.test(k))) {
      let text;
      try {
        text = run("show", `${base}:${f}`);
      } catch {
        continue; // new on this branch
      }
      for (const spec of specsOf(f, text)) importedOnMain.add(spec);
    }
  const imported = (file) =>
    EXTENSIONS.some(
      (e) => file.endsWith(e) && importedOnMain.has(file.slice(0, file.length - e.length)),
    );
  return [
    ...new Set([
      ...kept,
      ...(at ? [] : git("ls-files", "--others", "--exclude-standard")),
      ...deleted.filter((f) => !imported(f)),
    ]),
  ];
}
