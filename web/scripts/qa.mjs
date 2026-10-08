// `pnpm --silent qa`: looking at the site, for agents (AXI style: live state when run bare,
// compact rows, only what is wrong, a next step after every answer, errors on stdout with
// exit code 1). `check` draws every page at several sizes on a target and a reference,
// reports layout faults, errors and changed pixels, and writes one picture per changed view
// to read in place of the screenshots. What it looks at: scripts/qa/catalogue.mjs.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { compare } from "./qa/compare.mjs";
import { launch, parseView, render, viewName } from "./qa/browser.mjs";
import { IDS, PAGES, STATES } from "./qa/catalogue.mjs";
import { preview, resolve, up } from "./qa/targets.mjs";

const OUT = fileURLToPath(new URL("../../scratch/qa/", import.meta.url));
const SIZES = "320/20,390,820,1280";
const HELP = {
  "": `usage: pnpm --silent qa [command] [flags]
  (none)    targets and what there is to check
  check     every page at every size on a target, against a reference
  shot      one view's screenshot
views are page[+state][@width[/text]], e.g. player+compare@320/20 (text in px, 16 by default)
targets are prod, preview (this branch's), local[:port] or a URL
run \`pnpm --silent qa <command> --help\` for a command's flags`,
  check: `usage: pnpm --silent qa check [--at preview] [--against prod] [--pages a,b] [--sizes ${SIZES}] [--no-states] [--assert] [--jobs 4]
  --at        the target (default preview)
  --against   the reference, or "none" to look for faults only (default prod)
  --pages     page or page+state names to keep (default all)
  --sizes     width[/text] list (default ${SIZES})
  --no-states skip the states a click opens (dialogs, sheets)
  --assert    exit 1 when any fault is found; the CI form, with --against none
  --jobs      views drawn at once (default 4)`,
  shot: `usage: pnpm --silent qa shot <view> [--at preview] [--el <selector>] [--full] [--box <selector>] [--eval <js>]
  writes the view's screenshot to scratch/qa/ and prints its path, faults and errors
  --el    only this element
  --full  the whole page, past the 4000px check cuts at
  --box   print the box of each element the selector matches (x, right, page y, size, text)
  --eval  print the value of this expression, run in the page`,
};

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const say = (lines) => {
  console.log(Array.isArray(lines) ? lines.join("\n") : lines);
};
const fail = (message, help = "") => {
  say([`error: ${message}`, ...(help ? [help] : [])]);
  process.exit(1);
};
const command = argv[0] && !argv[0].startsWith("--") ? argv.shift() : "";
if (!(command in HELP)) fail(`unknown command "${command}"`, HELP[""]);
if (argv.includes("--help")) {
  say(HELP[command]);
  process.exit(0);
}
const FLAGS = {
  check: ["at", "against", "pages", "sizes", "jobs"],
  shot: ["at", "el", "box", "eval"],
  "": [],
};
const SWITCHES = { check: ["no-states", "assert"], shot: ["full"], "": [] };
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) positional.push(a);
  else if (SWITCHES[command].includes(a.slice(2))) flags[a.slice(2)] = true;
  else if (FLAGS[command].includes(a.slice(2)) && argv[i + 1] !== undefined)
    flags[a.slice(2)] = argv[++i];
  else fail(`unknown flag ${a}`, HELP[command]);
}

const target = (spec) => resolve(spec) ?? fail(`not a target: "${spec}"`, HELP[""]);
/* a catalogue page, or a bare path; its path with the target's IDs, and the status it answers */
const pageOf = (page, ids = "real") => {
  const [, path = page.startsWith("/") ? page : null, status = 200] =
    PAGES.find(([n]) => n === page) ?? [];
  return { path: path?.replace(/\{(\w+)\}/g, (_, k) => IDS[ids][k]), status };
};
const stateOf = (name) => STATES.find(([n]) => n === name);
const rel = (p) => p.replace(fileURLToPath(new URL("../../", import.meta.url)), "");
const describe = (t) =>
  t.name === "preview"
    ? `preview ${t.url} (${t.sha ?? "?"}, ${t.state}${t.behind ? ", behind HEAD" : ""})`
    : `${t.name} ${t.url}`;
/* TOON-style rows: name[n]{fields}: then one comma-separated line each */
const rows = (name, fields, list) =>
  list.length === 0
    ? [`${name}: 0`]
    : [
        `${name}[${String(list.length)}]{${fields.join(",")}}:`,
        ...list.map((r) => "  " + fields.map((f) => String(r[f] ?? "")).join(",")),
      ];

// ---------------------------------------------------------------- commands

if (command === "") await home();
else if (command === "shot") await shot();
else await check();

async function home() {
  const local = resolve("local");
  const p = preview();
  say([
    "targets:",
    `  prod     ${resolve("prod").url}`,
    `  preview  ${p.url} (${p.sha ?? "no deployment"}, ${p.state}${p.behind ? ", behind HEAD: push or wait" : ""})`,
    `  local    ${local.url} (${(await up(local.url)) ? "up" : "down: pnpm serve 3000, seeded with stress"})`,
    `pages[${String(PAGES.length)}]: ${PAGES.map(([n]) => n).join(", ")}`,
    `states[${String(STATES.length)}]: ${STATES.map(([n, pg]) => `${pg}+${n}`).join(", ")}`,
    `sizes: ${SIZES} (width/text px)`,
    "next:",
    "  pnpm --silent qa check                      # preview against prod, every page and size",
    "  pnpm --silent qa check --pages vs,player    # just those",
    "  pnpm --silent qa shot vs@320/20             # one view, to read",
  ]);
}

async function shot() {
  const view = positional[0] ? parseView(positional[0]) : null;
  if (!view) fail("name a view, like player@390", HELP.shot);
  const t = target(flags.at ?? "preview");
  const { path } = pageOf(view.page, t.ids);
  if (!path) fail(`no page "${view.page}"`, `pages: ${PAGES.map(([n]) => n).join(", ")}`);
  const browser = await launch();
  try {
    const r = await render(browser, t.url + path, view, {
      control: view.state ? stateOf(view.state)?.[2] : undefined,
      now: Date.now(),
      full: !!flags.full,
      element: flags.el,
      boxes: flags.box,
      script: flags.eval,
    });
    if (r.skipped) fail(`${viewName(view)}: ${r.skipped} at this width`);
    if (r.status !== pageOf(view.page).status) fail(`${t.url + path} answered ${String(r.status)}`);
    mkdirSync(OUT, { recursive: true });
    const file = OUT + "shot-" + viewName(view).replaceAll("/", "-") + ".png";
    writeFileSync(file, r.shot);
    say([
      `${viewName(view)} on ${describe(t)}`,
      `image: ${rel(file)}`,
      ...rows("faults", ["kind", "where", "px"], faults(r)),
      ...rows("errors", ["where", "detail"], r.errors),
      ...(flags.box ? rows("boxes", ["x", "right", "y", "w", "h", "text"], r.measured) : []),
      ...(flags.eval ? [`eval: ${JSON.stringify(r.evaluated)}`] : []),
      "next:",
      `  read ${rel(file)}`,
    ]);
  } finally {
    await browser.close();
  }
}

/* the layout probes' findings as rows */
function faults(r) {
  if (!r.probes) return [];
  const out = [];
  if (r.probes.overflow) out.push({ kind: "overflow", where: "page", px: r.probes.overflow });
  for (const [where, px] of r.probes.offscreen) out.push({ kind: "offscreen", where, px });
  for (const [where, px] of r.probes.clipped) out.push({ kind: "clipped", where, px });
  for (const [where, px] of r.probes.overlap) out.push({ kind: "overlap", where, px });
  return out;
}

async function check() {
  const at = target(flags.at ?? "preview");
  const ref = flags.against === "none" ? null : target(flags.against ?? "prod");
  if (at.name === "preview" && at.state !== "success")
    fail(`the preview is ${at.state}`, "push the branch and wait for Vercel, or pass --at local");
  const sizes = (flags.sizes ?? SIZES).split(",").map((s) => {
    const [w, t] = s.split("/").map(Number);
    if (!w) fail(`not a size: "${s}"`, HELP.check);
    return { width: w, text: t || 16 };
  });
  const keep = flags.pages?.split(",");
  const views = [];
  for (const [page] of PAGES) for (const s of sizes) views.push({ page, ...s });
  if (!flags["no-states"])
    for (const [state, page] of STATES) for (const s of sizes) views.push({ page, state, ...s });
  const chosen = views.filter(
    (v) => !keep || keep.includes(v.page) || keep.includes(`${v.page}+${v.state ?? ""}`),
  );
  if (!chosen.length) fail("no view matches --pages", `pages: ${PAGES.map(([n]) => n).join(", ")}`);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const started = Date.now();
  const browser = await launch();
  const found = [],
    diffs = [],
    skipped = [];
  try {
    const queue = [...chosen];
    const work = async () => {
      for (let v = queue.shift(); v; v = queue.shift()) await one(v);
    };
    const one = async (v) => {
      const name = viewName(v);
      const control = v.state ? stateOf(v.state)[2] : undefined;
      const expect = pageOf(v.page).status;
      const draw = (t) =>
        render(browser, t.url + pageOf(v.page, t.ids).path, v, { control, now: started }).catch(
          (e) => ({ failed: String(e.message).split("\n")[0] }),
        );
      const [a, b] = await Promise.all([draw(at), ref ? draw(ref) : null]);
      // a side that did not draw is a fault of its own, and nothing to compare against
      const broken = (r, t) => {
        if (r.failed) found.push({ view: name, kind: "failed", where: t.name, detail: r.failed });
        else if (r.status !== expect)
          found.push({
            view: name,
            kind: "status",
            where: t.name,
            detail: `${String(r.status)}, expected ${String(expect)}`,
          });
        else return false;
        return true;
      };
      if (broken(a, at)) return;
      const before = b && !broken(b, ref) && !b.skipped ? b : null;
      if (a.skipped) return skipped.push(name);
      const seen = (kind, where) =>
        before
          ? faults(before).some((f) => f.kind === kind && f.where === where)
            ? "also"
            : "new"
          : "";
      for (const f of faults(a))
        found.push({
          view: name,
          kind: f.kind,
          where: f.where,
          detail: `${String(f.px)}px`,
          ref: seen(f.kind, f.where),
        });
      for (const e of a.errors) {
        const also = before?.errors.some((x) => x.where === e.where && x.detail === e.detail);
        found.push({
          view: name,
          kind: "error",
          where: e.where,
          detail: e.detail.slice(0, 100),
          ref: before ? (also ? "also" : "new") : "",
        });
      }
      if (!before) return;
      const d = await compare(browser, before.shot, a.shot, [ref.name, at.name, "changed"]);
      if (!d.changed) return;
      const file = OUT + name.replaceAll("/", "-") + ".png";
      writeFileSync(file, d.image);
      const [[, ha], [, hb]] = d.sizes;
      diffs.push({
        sig: `${String(v.width)}/${String(v.text)} ${d.sig}`,
        view: name,
        px: d.changed,
        box: d.box.join(" "),
        height: ha === hb ? "" : `${String(ha)}->${String(hb)}`,
        shows: d.shown.join("-"),
        image: rel(file),
      });
    };
    await Promise.all(Array.from({ length: Number(flags.jobs ?? 4) }, work));
  } finally {
    await browser.close();
  }

  // one row per fault, with every view it shows in: a header fault is on every page
  const grouped = new Map();
  for (const f of found.sort((x, y) => x.view.localeCompare(y.view))) {
    const key = [f.kind, f.where, f.detail, f.ref].join("|");
    grouped.set(key, { ...f, views: [...(grouped.get(key)?.views ?? []), f.view] });
  }
  const faultRows = [...grouped.values()].map((f) => ({
    ...f,
    views:
      f.views.length > 4
        ? `${f.views.slice(0, 3).join(" ")} +${String(f.views.length - 3)} more`
        : f.views.join(" "),
  }));
  // one picture per change: views whose changes start the same way share the largest's
  const shared = new Map();
  for (const d of diffs.sort((x, y) => y.px - x.px)) {
    const first = shared.get(d.sig);
    if (first) first.alike.push(d.view);
    else shared.set(d.sig, { ...d, alike: [] });
  }
  const diffRows = [...shared.values()].map((d) => ({
    ...d,
    alike:
      d.alike.length > 4
        ? `${d.alike.slice(0, 3).join(" ")} +${String(d.alike.length - 3)} more`
        : d.alike.join(" "),
  }));
  const secs = Math.round((Date.now() - started) / 1000);
  say([
    `checked ${String(chosen.length - skipped.length)} views of ${describe(at)}${ref ? ` against ${describe(ref)}` : ""} in ${String(secs)}s`,
    ...rows("faults", ["kind", "where", "detail", ...(ref ? ["ref"] : []), "views"], faultRows),
    ...(ref
      ? rows("changed", ["view", "px", "box", "height", "shows", "image", "alike"], diffRows)
      : []),
    ...(skipped.length
      ? [`skipped[${String(skipped.length)}] (control hidden at that width): ${skipped.join(", ")}`]
      : []),
    "next:",
    ...(diffs.length
      ? [
          `  read each image (${ref.name} | ${at.name} | changed pixels in red); the views under "alike" start changing the same way`,
        ]
      : []),
    ...(found.some((f) => f.ref !== "also")
      ? ["  pnpm --silent qa shot <view> --el <where>   # look at a fault"]
      : []),
    ...(!diffs.length && !found.length ? ["  nothing to look at"] : []),
  ]);
  if (flags.assert && found.length) process.exit(1);
}
