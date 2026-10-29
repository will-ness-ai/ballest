// `pnpm --silent qa`: looking at the site, for agents (AXI style: live state when run bare,
// compact rows, only what is wrong, a next step after every answer, errors on stdout with
// exit code 1). `check` draws the pages a branch's changes reach (qa/reach.mjs), or every
// page, at several sizes on a target and a reference,
// reports layout faults, errors and changed pixels, and writes one picture per changed view
// to read in place of the screenshots. What it looks at: scripts/qa/catalogue.mjs.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { compare } from "./qa/compare.mjs";
import { cardHtml, compose, overviewHtml, variantsOf } from "./qa/sheet.mjs";
import { launch, parseView, render, viewName } from "./qa/browser.mjs";
import { IDS, PAGES, STATES } from "./qa/catalogue.mjs";
import { landsElsewhere } from "./qa/landing.mjs";
import { changedFiles, reach } from "./qa/reach.mjs";
import { REFS, pieces } from "./qa/piece.mjs";
import { fmt, matching, pagesOf, rankRows } from "./qa/piece-math.mjs";
import { signIn } from "./qa/session.mjs";
import { preview, resolve, up } from "./qa/targets.mjs";

const OUT = fileURLToPath(new URL("../../scratch/qa/", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SIZES = "320/20,390,820,1280";
const HELP = {
  "": `usage: pnpm --silent qa [command] [flags]
  (none)    targets and what there is to check
  check     the pages this branch reaches (or every page) at every size, against a reference
  shot      one view's screenshot
  piece     an editor piece's stand-in against the game mesh's render
  render    a Prefab file or a Generator's output drawn to a picture, no page or deploy
  sheet     a grill-design round's variants as pictures to post: a card each and an overview
views are page[+state][@width[/text]], e.g. player+compare@320/20 (text in px, 16 by default);
  a page is a catalogue name or any path, e.g. /campaign/solar-trials@390
targets are prod, preview (this branch's), local[:port] or a URL
run \`pnpm --silent qa <command> --help\` for a command's flags`,
  check: `usage: pnpm --silent qa check [--at preview] [--against prod] [--pages a,b | --all] [--sizes ${SIZES}] [--no-states] [--assert] [--jobs 4]
  --at        the target (default preview)
  --against   the reference, or "none" to look for faults only (default prod)
  --pages     page or page+state names to keep (default: the pages this branch's changes
              reach from main, or every page when a change can show on any)
  --all       every page, whatever the branch changes
  --sizes     width[/text] list (default ${SIZES})
  --no-states skip the states a click opens (dialogs, sheets)
  --assert    exit 1 when any fault is found; the CI form, with --against none
  --jobs      views drawn at once (default 4)
fault kinds: overflow (page scrolls sideways), offscreen, clipped (text or placeholder cut),
  overlap (text over text), error (page, console or a failed load), scroll (lands elsewhere
  on load than the reference), missing (a state's control at no size), signed-out (the
  site refused qa's session: give qa the server's SESSION_SECRET), failed, status,
  gone (answers 200 but its title says not found: the catalogue's ID is wrong)`,
  shot: `usage: pnpm --silent qa shot <view> [--at preview] [--el <selector>] [--full] [--box <selector>] [--eval <js>] [--prefab <file.json>]
  writes the view's screenshot to scratch/qa/ and prints its path, faults and errors
  --el    only this element
  --full  the whole page, past the 4000px check cuts at
  --box   print the box of each element the selector matches (x, right, page y, size, text)
  --eval  print the value of this expression, run in the page
  --prefab  a Prefab file the page's viewer draws in place of the real one (prefab@1280
          --prefab sign.json): the viewer as that target builds it, on any file`,
  render: `usage: pnpm --silent qa render <file.json | generator> [--set key=value]... [--items 0-5,9] [--from top|front|side|x,y,z] [--size 1200x800]
  draws a Prefab file, or what a Generator (its key, e.g. sign) makes, with the share images'
  rasterizer, writes it to scratch/qa/ and prints its path, its pieces and how far it reaches
  (Unreal x, y, z in cm)
  --set    a Generator's value over its default, once per key (e.g. --set font=Leker --set
           "text=Hi there"); a font the browser draws letters in Pixel here
  --items  only the pieces at these places in the file, to see which pieces make what
  --from   where the camera looks from: top, front (a sign's face, from -X), side, or a
           direction in three's axes (y up); default the Generator's angle or the Prefab's
  --size   the picture in px (default 1200x800)
examples:
  pnpm --silent qa render sign --set font=Graduate --set "text=Welcome!"
  pnpm --silent qa render ~/alphabet.json --from top --items 7-12`,
  sheet: `usage: pnpm --silent qa sheet <path> [--at preview] [--el <selector>] [--variants A,B] [--pick A] [--title <text>] [--out <dir>]
  draws each of a prototype's variants (<path>?variant=<key>) at 1280 and 390 px and writes,
  to scratch/qa/sheet/, a card per variant (its name and note over its desktop and phone
  shots, side by side, readable on a phone) and an overview (every variant small, a row each),
  so the round can be judged in the thread without opening the preview
  --el        only this element of the page, e.g. the feature's section (default the top of
              the page), plus page.jpg: the pick (or the first) as the whole page, once; a
              tall shot is cut and the cut says by how much
  --variants  the keys to draw (default every variant the page's picker lists in its
              data-variants: [key, name, note] each)
  --pick      the variant to mark as your pick
  --title     the round's question, over the overview
  --out       also copy the pictures here (e.g. /mnt/project-files/<feature>/round1)
examples:
  pnpm --silent qa sheet /trials --at local:3311 --el .tp --pick A --title "What Trials opens"
  pnpm --silent qa sheet /players --variants A,C --out /mnt/project-files/players/round2`,
  piece: `usage: pnpm --silent qa piece <mesh> | --all [--match <regex>] [--montage] [--refs <dir>]
  draws the viewer's stand-in for a mesh (its asset name, e.g. SM_1000_90turn) from the top,
  front and side, orthographic, and scores each view's outline against the game mesh's
  render: 1.00 is the same outline. Renders follow the framing in piece-math.mjs
  <mesh>  one mesh: its scores and a sheet to read (game | viewer | outlines, red only the
          game's, cyan only the viewer's)
  --all   every mesh the viewer knows, worst first, no pictures
  --match with --all, only meshes whose name or stand-in kind matches (any case), e.g.
          "scoop" or "\\+" (stand-ins drawn from two outlines)
  --montage  with --all, also the listed meshes' game and viewer rows in pictures of 16,
          worst first, to look the lot over in a few reads
  --refs  the folder of <mesh>-<view>-mask.png and -ortho.png renders
          (default the ballest-map-making checkout beside this one: references/pieces/)
  the viewer side is the site's scene code (components/prefabs/scene.ts) drawn here, so its
  shaded picture can differ slightly in colour from the page; the outlines don't
examples:
  pnpm --silent qa piece --all
  pnpm --silent qa piece --all --match scoop --montage
  pnpm --silent qa piece SM_1000_90turn
  pnpm --silent qa piece Torus --refs ~/renders/`,
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
  shot: ["at", "el", "box", "eval", "prefab"],
  sheet: ["at", "el", "variants", "pick", "title", "out"],
  piece: ["refs", "match"],
  render: ["set", "items", "from", "size"],
  "": [],
};
const SWITCHES = {
  check: ["no-states", "assert", "all"],
  shot: ["full"],
  sheet: [],
  piece: ["all", "montage"],
  render: [],
  "": [],
};
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) positional.push(a);
  else if (SWITCHES[command].includes(a.slice(2))) flags[a.slice(2)] = true;
  else if (!FLAGS[command].includes(a.slice(2))) fail(`unknown flag ${a}`, HELP[command]);
  else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--"))
    fail(`${a} needs a value`, HELP[command]);
  else if (a === "--set") (flags.set ??= []).push(argv[++i]);
  else flags[a.slice(2)] = argv[++i];
}
const jobs = Number(flags.jobs ?? 4);
if (!Number.isInteger(jobs) || jobs < 1) fail(`--jobs takes a whole number from 1`, HELP.check);

const target = (spec) => resolve(spec) ?? fail(`not a target: "${spec}"`, HELP[""]);
/* a catalogue page, or a bare path; its path with the target's IDs, and the status it answers */
const pageOf = (page, ids = "real") => {
  const p = PAGES.find((x) => x.name === page);
  const path = p?.path ?? (page.startsWith("/") ? page : null);
  return { path: path?.replace(/\{(\w+)\}/g, (_, k) => IDS[ids][k]), status: p?.status ?? 200 };
};
const stateOf = (name) => STATES.find((x) => x.name === name);
const UNSIGNED =
  "signed in: only a local target, under its SESSION_SECRET (env or web/.env*) or else qa-only, which pnpm serve, pnpm dev:up and CI serve under";
const pageNames = `pages: ${PAGES.map((p) => p.name).join(", ")}`;
/* a list cut to its first three once it runs past four */
const few = (list) =>
  list.length > 4
    ? `${list.slice(0, 3).join(" ")} +${String(list.length - 3)} more`
    : list.join(" ");
/* "1 fault", "3 faults" */
const plural = (n, noun) => `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
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
else if (command === "sheet") await sheet();
else if (command === "piece") await piece();
else if (command === "render") renderFile();
else await check();

async function home() {
  const local = resolve("local");
  const p = preview();
  say([
    "targets:",
    `  prod     ${resolve("prod").url}`,
    `  preview  ${p.url} (${p.sha ?? "no deployment"}, ${p.state}${p.behind ? ", behind HEAD: push or wait" : ""})`,
    `  local    ${local.url} (${(await up(local.url)) ? "up" : "down: pnpm serve 3000, seeded with stress"})`,
    `pages[${String(PAGES.length)}]: ${PAGES.map((p) => p.name).join(", ")}`,
    `states[${String(STATES.length)}]: ${STATES.map((x) => `${x.page}+${x.name}`).join(", ")}`,
    `sizes: ${SIZES} (width/text px)`,
    "next:",
    "  pnpm --silent qa check                      # preview against prod, the pages this branch reaches",
    "  pnpm --silent qa check --all                # every page and size",
    "  pnpm --silent qa check --pages vs,player    # just those",
    "  pnpm --silent qa shot vs@320/20             # one view, to read",
  ]);
}

async function shot() {
  const view = positional[0] ? parseView(positional[0]) : null;
  if (!view) fail("name a view, like player@390", HELP.shot);
  const t = target(flags.at ?? "preview");
  const { path, status } = pageOf(view.page, t.ids);
  if (!path) fail(`no page "${view.page}"`, pageNames);
  const state = view.state ? stateOf(view.state) : undefined;
  if (view.state && !state)
    fail(`no state "${view.state}"`, `states: ${STATES.map((x) => x.name).join(", ")}`);
  const now = Date.now();
  const signed = signIn(view.page, t, now) ?? fail(`${view.page} is drawn ${UNSIGNED}`);
  const browser = await launch();
  try {
    const r = await render(browser, t.url + path, view, {
      control: state?.click,
      typed: state?.type,
      now,
      cookies: signed.cookies,
      full: !!flags.full,
      element: flags.el,
      boxes: flags.box,
      script: flags.eval,
      prefab: flags.prefab && readPrefab(flags.prefab),
    });
    // a refused session is the first thing wrong: the page was drawn signed out
    if (r.me !== signed.as)
      fail(
        `${t.url} didn't take the browser as signed in`,
        t.fallback
          ? "serve it with pnpm serve or pnpm dev:up, or give it and qa a SESSION_SECRET"
          : "give qa the server's SESSION_SECRET",
      );
    if (r.skipped) fail(`${viewName(view)}: ${r.skipped} at this width`);
    if (r.status !== status) fail(`${t.url + path} answered ${String(r.status)}`);
    if (gone(r, status))
      fail(
        `${t.url + path} says "${r.title}"`,
        "point its ID in scripts/qa/catalogue.mjs at one that exists",
      );
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

async function sheet() {
  const path = positional[0];
  if (!path?.startsWith("/")) fail("name the page's path, like /trials", HELP.sheet);
  const t = target(flags.at ?? "preview");
  if (t.name === "preview" && t.state !== "success")
    fail(
      `this branch's preview is ${t.state}${t.behind ? ", behind HEAD" : ""}`,
      "push and wait for it, or draw a local server: --at local:<port>",
    );
  if (t.url.includes("localhost") && !(await up(t.url)))
    fail(`nothing answers on ${t.url}`, `serve the prototype: pnpm dev:up ${new URL(t.url).port}`);
  const now = Date.now();
  const urlOf = (key) => {
    const u = new URL(t.url + path);
    if (key) u.searchParams.set("variant", key);
    return u.href;
  };
  const LIST = `document.querySelector(".proto-picker")?.dataset.variants ?? null`;
  const browser = await launch();
  try {
    const draw = async (key, width) => {
      try {
        return await render(
          browser,
          urlOf(key),
          { width, text: 16 },
          {
            now,
            element: flags.el,
            script: LIST,
          },
        );
      } catch (e) {
        if (/Timeout/.test(String(e)) && flags.el)
          fail(
            `no ${flags.el} on ${urlOf(key)} at ${String(width)} px`,
            "check --el against the page",
          );
        throw e;
      }
    };
    let variants = variantsOf(null, flags.variants);
    if (!variants) {
      const first = await draw(null, 1280);
      variants = variantsOf(first.evaluated ?? null, undefined);
    }
    if (!variants)
      fail(
        `${urlOf(null)} has no variant picker listing its variants`,
        "name them: --variants A,B,C, or give ProtoPicker data-variants",
      );
    const drawn = [];
    /* with --el, the pick (or the first) once as the whole page too, to show where it sits */
    let inPage = null;
    const found = [];
    const errs = [];
    for (const v of variants) {
      const [desktop, phone] = [await draw(v.key, 1280), await draw(v.key, 390)];
      for (const [r, width] of [
        [desktop, 1280],
        [phone, 390],
      ]) {
        if (r.status >= 400) fail(`${urlOf(v.key)} answered ${String(r.status)}`);
        found.push(...faults(r).map((f) => ({ variant: v.key, width, ...f })));
        errs.push(...r.errors.map((e) => ({ variant: v.key, width, ...e })));
      }
      drawn.push({ v, desktop: desktop.shot, phone: phone.shot });
    }
    if (flags.el) {
      const v = variants.find((x) => x.key === flags.pick) ?? variants[0];
      const whole = async (width) =>
        (await render(browser, urlOf(v.key), { width, text: 16 }, { now })).shot;
      inPage = { v, desktop: await whole(1280), phone: await whole(390) };
    }
    const dir = OUT + "sheet/";
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const files = [];
    const write = (name, jpeg) => {
      writeFileSync(dir + name, jpeg);
      if (flags.out) {
        mkdirSync(flags.out, { recursive: true });
        writeFileSync(resolvePath(flags.out, name), jpeg);
      }
      files.push(flags.out ? resolvePath(flags.out, name) : rel(dir + name));
    };
    const title = flags.title ?? path;
    write("overview.jpg", await compose(browser, overviewHtml(drawn, { pick: flags.pick, title })));
    if (inPage)
      write(
        "page.jpg",
        await compose(
          browser,
          cardHtml(inPage.v, inPage, { pick: inPage.v.key === flags.pick, title: "in the page" }),
        ),
      );
    for (const d of drawn)
      write(
        `${d.v.key}.jpg`,
        await compose(browser, cardHtml(d.v, d, { pick: d.v.key === flags.pick, title })),
      );
    say([
      `sheet: ${path} on ${describe(t)}, ${plural(variants.length, "variant")}`,
      ...rows(
        "images",
        ["variant", "file"],
        files.map((file) => ({
          variant: /overview/.test(file)
            ? "all"
            : /page\.jpg$/.test(file)
              ? "in page"
              : basename(file, ".jpg"),
          file,
        })),
      ),
      ...(found.length
        ? rows("faults", ["variant", "width", "kind", "where", "px"], found)
        : [`faults: none in ${plural(variants.length * 2, "view")}`]),
      ...rows("errors", ["variant", "width", "where", "detail"], errs),
      "next:",
      `  read ${files[0]}   # the overview, to check the shots came out`,
      `  attach the overview${inPage ? ", page.jpg" : ""} and the cards to the round's message (6 files a message: the overview first)`,
    ]);
  } finally {
    await browser.close();
  }
}

async function piece() {
  const mesh = positional[0];
  if (!mesh === !flags.all) fail("name one mesh, or pass --all", HELP.piece);
  if (mesh && (flags.match || flags.montage))
    fail("--match and --montage go with --all", HELP.piece);
  const dir = flags.refs ? flags.refs.replace(/\/?$/, "/") : REFS;
  const p = await pieces(dir);
  try {
    if (mesh) {
      if (!p.meshes.includes(mesh))
        fail(`no stand-in for "${mesh}"`, `meshes[${String(p.meshes.length)}]: ${few(p.meshes)}`);
      const r = await p.run(mesh, true);
      mkdirSync(OUT, { recursive: true });
      const file = `${OUT}piece-${mesh}.png`;
      writeFileSync(file, r.sheet);
      say([
        `${mesh}: stand-in ${r.kind}`,
        r.scores
          ? `scores: ${Object.entries(r.scores)
              .map(([view, n]) => `${view} ${fmt(n)}`)
              .join(", ")}`
          : `scores: none (no renders in ${rel(dir)})`,
        `image: ${rel(file)}`,
        ...rows(
          "errors",
          ["detail"],
          p.errors.map((detail) => ({ detail })),
        ),
        "next:",
        `  read ${rel(file)}`,
        "  change its stand-in (components/prefabs/scene.ts, lib/prefab-meshes.ts) and run this again",
      ]);
    } else {
      const found = [];
      for (const m of p.meshes) {
        const r = await p.run(m, !!flags.montage);
        found.push({ mesh: m, kind: r.kind, scores: r.scores, sheet: r.sheet });
      }
      const ranked = matching(rankRows(found), flags.match);
      const images = [];
      if (flags.montage) {
        mkdirSync(OUT, { recursive: true });
        for (const [i, page] of pagesOf(ranked).entries()) {
          const file = `${OUT}pieces-${String(i + 1)}.png`;
          writeFileSync(file, await p.montage(page.map((r) => r.sheet)));
          images.push(rel(file));
        }
      }
      const missing = ranked.filter((r) => !r.scores).map((r) => r.mesh);
      const scored = ranked.filter((r) => r.scores);
      const refs = flags.refs ? ` --refs ${flags.refs}` : "";
      say([
        ...(scored.length
          ? rows("pieces", ["mesh", "kind", "worst", "top", "front", "side"], scored)
          : [`pieces: none scored of ${String(ranked.length)}`]),
        ...(images.length ? [`images[${String(images.length)}]: ${images.join(", ")}`] : []),
        ...(missing.length
          ? [`no renders in ${rel(dir)} for ${String(missing.length)}: ${few(missing)}`]
          : []),
        ...rows(
          "errors",
          ["detail"],
          p.errors.map((detail) => ({ detail })),
        ),
        "next:",
        ...images.map((f) => `  read ${f}`),
        scored.length
          ? `  pnpm --silent qa piece ${scored[0].mesh}${refs}   # the worst one's scores and sheet`
          : `  render the game meshes into ${rel(dir)} (piece-math.mjs has the framing)`,
      ]);
    }
  } finally {
    await p.close();
  }
}

function renderFile() {
  const what = positional[0];
  if (!what) fail("name a Prefab file or a Generator", HELP.render);
  mkdirSync(OUT, { recursive: true });
  const variant = [flags.from, flags.items]
    .filter(Boolean)
    .join("-")
    .replace(/[^\w-]/g, "_");
  const out = `${OUT}render-${basename(what, ".json")}${variant ? "-" + variant : ""}.png`;
  /* node itself with tsx's loader, which runs the same on Windows as anywhere */
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./qa/render.ts", import.meta.url)),
      JSON.stringify({
        ...flags,
        set: flags.set ?? [],
        what: existsSync(what) ? resolvePath(what) : what,
        out,
      }),
    ],
    { encoding: "utf8", cwd: fileURLToPath(new URL("../", import.meta.url)) },
  );
  if (run.error) fail(`the render didn't start: ${run.error.message}`);
  let r;
  try {
    r = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    /* an exception's own line, not the source line tsx prints over it */
    const lines = `${run.stderr}\n${run.stdout}`.split("\n");
    return fail(`the render failed: ${lines.find((l) => /Error\b/.test(l)) ?? lines[0]}`);
  }
  if (r.error) fail(r.error, HELP.render);
  const [x, y, z] = r.reach.map(([lo, hi]) => `${String(lo)}..${String(hi)}`);
  say([
    `image: ${rel(out)}`,
    `pieces: ${String(r.pieces)}${r.pieces === r.of ? "" : ` of ${String(r.of)}`}`,
    `reach: x ${x}, y ${y}, z ${z} (cm)`,
    ...r.notes.map((n) => `note: ${n}`),
    "next:",
    `  read ${rel(out)}`,
  ]);
}

/* a Prefab file's text for --prefab, or the error that names the path */
function readPrefab(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return fail(`can't read ${file}`, "give --prefab the path of a Prefab's .json file");
  }
}

/* a page meant to be there whose title says not found: a stale catalogue ID. A streamed page
   (a Prefab's) answers 200 even then, so its status can't tell. */
function gone(r, expect) {
  return expect < 400 && /not (be )?found/i.test(r.title ?? "");
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
  if (flags.pages && flags.all)
    fail("--pages and --all choose the pages two ways: pass one", HELP.check);
  /* this branch's own build is narrowed to what its changes reach; any other target is all */
  let scope = null;
  if ((at.name === "preview" || at.ids === "stress") && !flags.pages && !flags.all) {
    let changed;
    try {
      /* a preview holds the commit it was built from; a local build may hold the working tree */
      changed = changedFiles(ROOT, { at: at.name === "preview" ? at.commit : undefined });
    } catch (e) {
      fail(
        `git can't tell what this branch changes: ${String(e instanceof Error ? e.message : e).split("\n")[0]}`,
        "git fetch origin main, or pass --all or --pages",
      );
    }
    scope = reach(changed, ROOT);
  }
  const gaps = scope?.routes.length
    ? [
        `uncatalogued[${String(scope.routes.length)}] pages it reaches, not checked: ${scope.routes.join(", ")}`,
      ]
    : [];
  if (scope && !scope.all && !scope.pages.length) {
    say([
      "checked 0 views: nothing this branch changes from main shows on a catalogue page",
      ...gaps,
      "next:",
      "  pnpm --silent qa check --all   # every page anyway",
    ]);
    return;
  }
  const keep =
    flags.pages?.split(",") ?? (scope?.all ? undefined : scope?.pages.map((p) => p.name));
  const views = [];
  for (const { name, minWidth = 0 } of PAGES)
    for (const s of sizes) if (s.width >= minWidth) views.push({ page: name, ...s });
  if (!flags["no-states"])
    for (const { name, page } of STATES)
      for (const s of sizes) views.push({ page, state: name, ...s });
  const chosen = views.filter(
    (v) => !keep || keep.includes(v.page) || keep.includes(`${v.page}+${v.state ?? ""}`),
  );
  if (!chosen.length) fail("no view matches --pages", pageNames);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const started = Date.now();
  const browser = await launch();
  const found = [],
    diffs = [],
    skipped = [],
    unsigned = [],
    uncompared = [];
  try {
    const queue = [...chosen];
    const work = async () => {
      for (let v = queue.shift(); v; v = queue.shift()) await one(v);
    };
    const one = async (v) => {
      const name = viewName(v);
      const control = v.state ? stateOf(v.state).click : undefined;
      const expect = pageOf(v.page).status;
      const [signA, signB] = [at, ref].map((t) => t && signIn(v.page, t, started));
      if (!signA) return unsigned.push(name);
      const draw = (t, signed) =>
        render(browser, t.url + pageOf(v.page, t.ids).path, v, {
          control,
          typed: v.state ? stateOf(v.state).type : undefined,
          now: started,
          cookies: signed.cookies,
        })
          .then((r) => ({ ...r, as: signed.as }))
          .catch((e) => ({ failed: String(e.message).split("\n")[0] }));
      // a reference that can't sign in has nothing to compare against
      const [a, b] = await Promise.all([draw(at, signA), signB ? draw(ref, signB) : null]);
      if (ref && !b) uncompared.push(name);
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
        else if (gone(r, expect))
          found.push({ view: name, kind: "gone", where: t.name, detail: r.title });
        // refused under qa's fallback secret: a server started without pnpm serve or dev:up
        // and no secret of its own, which can't sign anyone in; unsigned, not a fault
        else if (r.me !== r.as && t.fallback) (t === at ? unsigned : uncompared).push(name);
        else if (r.me !== r.as)
          found.push({ view: name, kind: "signed-out", where: t.name, detail: "session refused" });
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
      const landed = landsElsewhere(before.probes, a.probes);
      if (landed)
        found.push({ view: name, kind: "scroll", where: "page", detail: landed, ref: "new" });
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
    await Promise.all(Array.from({ length: jobs }, work));
  } finally {
    await browser.close();
  }

  // a state whose control no size showed: the selector no longer finds it. Every control
  // shows on a phone (some only there) but a `wide` one (the search field), which shows on
  // a desktop only, so a run without such a width can't tell
  const widths = {
    phone: sizes.some((s) => s.width < 600),
    wide: sizes.some((s) => s.width >= 820),
  };
  for (const st of STATES) {
    if (!widths[st.wide ? "wide" : "phone"]) continue;
    const names = chosen
      .filter((v) => v.state === st.name)
      .map(viewName)
      .filter((n) => !unsigned.includes(n));
    if (names.length && names.every((n) => skipped.includes(n)))
      found.push({
        view: names[0],
        kind: "missing",
        where: `${st.page}+${st.name}`,
        detail: `no ${st.click} at any size`,
      });
  }

  // one row per fault, with every view it shows in: a header fault is on every page
  const grouped = new Map();
  for (const f of found.sort((x, y) => x.view.localeCompare(y.view))) {
    const key = [f.kind, f.where, f.detail, f.ref].join("|");
    grouped.set(key, { ...f, views: [...(grouped.get(key)?.views ?? []), f.view] });
  }
  const faultRows = [...grouped.values()].map((f) => ({ ...f, views: few(f.views) }));
  // one picture per change: views whose changes start the same way share the largest's
  const shared = new Map();
  for (const d of diffs.sort((x, y) => y.px - x.px)) {
    const first = shared.get(d.sig);
    if (first) first.alike.push(d.view);
    else shared.set(d.sig, { ...d, alike: [] });
  }
  const diffRows = [...shared.values()].map((d) => ({ ...d, alike: few(d.alike) }));
  const secs = Math.round((Date.now() - started) / 1000);
  const report = [
    `checked ${String(chosen.length - skipped.length - unsigned.length)} views of ${describe(at)}${ref ? ` against ${describe(ref)}` : ""} in ${String(secs)}s`,
    ...(scope?.all ? [`pages: all, as ${scope.all} can show on any`] : []),
    ...(scope && !scope.all
      ? [
          `pages[${String(scope.pages.length)}] this branch reaches (--all for every page): ${few(scope.pages.map((p) => p.name))}`,
        ]
      : []),
    ...gaps,
    ...rows("faults", ["kind", "where", "detail", ...(ref ? ["ref"] : []), "views"], faultRows),
    ...(ref
      ? rows("changed", ["view", "px", "box", "height", "shows", "image", "alike"], diffRows)
      : []),
    ...(skipped.length
      ? [`skipped[${String(skipped.length)}] (control hidden at that width): ${skipped.join(", ")}`]
      : []),
    ...(unsigned.length
      ? [`unsigned[${String(unsigned.length)}] (drawn ${UNSIGNED}): ${few(unsigned)}`]
      : []),
    ...(uncompared.length
      ? [`uncompared[${String(uncompared.length)}] (${ref.name} can't sign in): ${few(uncompared)}`]
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
    /* last, so the end of a long report still says whether anything is wrong */
    `summary: ${plural(faultRows.filter((f) => f.ref !== "also").length, ref ? "new fault" : "fault")}${ref ? `, ${plural(diffs.length, "view")} changed (${plural(diffRows.length, "picture")} to read)` : ""}${gaps.length + uncompared.length ? ", and gaps above" : ""}`,
  ];
  say(report);
  // in CI, the job's summary for people, and a notice a cloud session can read, since it
  // can't read the job's log: gh api repos/<repo>/check-runs/<build job id>/annotations
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## qa check\n\n\`\`\`\n${report.join("\n")}\n\`\`\`\n`,
    );
  if (process.env.GITHUB_ACTIONS) say(`::notice title=qa check::${report.join("%0A")}`);
  if (flags.assert && found.length) process.exit(1);
}
