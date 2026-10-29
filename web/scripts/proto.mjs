// `pnpm --silent proto`: grill-design's prototypes, for agents. Follows the agent-tools skill
// (AXI style: rows, only what is wrong, a next step after every answer, errors on stdout, exit
// 1 for a failure and 2 for a usage error). `sheet` draws a round's variants as pictures to
// post in the thread. It belongs to grill-design and is meant to move into that skill, so it
// leans on nothing in `pnpm qa`: scripts/proto/ is all it needs.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { draw, launch, pickerList } from "./proto/draw.mjs";
import { cardHtml, compose, overviewHtml, variantsOf } from "./proto/sheet.mjs";

const OUT = fileURLToPath(new URL("../../scratch/proto/", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HELP = {
  "": `usage: pnpm --silent proto <command> [flags]
  sheet   a grill-design round's variants as pictures to post: an overview, the pick in the
          whole page, and a card per variant, each in a browser window and a phone
run \`pnpm --silent proto <command> --help\` for a command's flags`,
  sheet: `usage: pnpm --silent proto sheet <url> [--el <selector>] [--variants A,B] [--pick A] [--title <text>] [--out <dir>]
  draws each of a prototype's variants (<url>?variant=<key>) at 1280 and 390 px and writes,
  to scratch/proto/sheet/, overview.jpg (every variant small, a row each), page.jpg (with
  --el: the pick, or the first, as the whole page down to the feature) and
  variant-<key>.jpg (a card each: its desktop shot in a browser window beside its phone shot
  in a phone, readable on a phone), so the round can be judged without opening the preview
  <url>       the prototype page: a preview's or a local server's, e.g.
              http://localhost:3311/trials
  --el        only this element of the page, e.g. the feature's section (default the top of
              the page); a tall shot is cut and the cut says by how much
  --variants  the keys to draw, from those the picker lists (default all of them, from its
              data-variants: [key, name, note] each)
  --pick      the variant to mark as your pick
  --title     the round's question, over the overview
  --out       also copy the pictures here (e.g. /mnt/project-files/<feature>/round1)
examples:
  pnpm --silent proto sheet http://localhost:3311/trials --el .tp --pick A --title "What Trials opens"
  pnpm --silent proto sheet https://<preview>/players --variants A,C --out /mnt/project-files/players/round2`,
};
const FLAGS = { sheet: ["el", "variants", "pick", "title", "out"], "": [] };

const say = (lines) => {
  console.log(lines.join("\n"));
};
const fail = (message, help = "", code = 1) => {
  say([`error: ${message}`, ...(help ? [help] : [])]);
  process.exit(code);
};
const usage = (message, help) => fail(message, help, 2);
/* TOON-style rows: name[n]{fields}: then one comma-separated line each */
const rows = (name, fields, list) =>
  list.length === 0
    ? [`${name}: 0`]
    : [
        `${name}[${String(list.length)}]{${fields.join(",")}}:`,
        ...list.map(
          (r) =>
            "  " +
            fields
              .map((f) => {
                const v = String(r[f] ?? "");
                return /[,:"]/.test(v) ? JSON.stringify(v) : v;
              })
              .join(","),
        ),
      ];
const rel = (p) => p.replace(ROOT, "");
/* one row per distinct error, with the views that raised it: a warning every view raises
   prints once, cut to its first line */
const sameErrors = (list) => {
  const by = new Map();
  for (const e of list) {
    const detail = e.detail.split("\n")[0].slice(0, 200);
    const key = e.where + "\0" + detail;
    const row = by.get(key) ?? { where: e.where, detail, at: [] };
    row.at.push(`${e.variant}@${String(e.width)}`);
    by.set(key, row);
  }
  return [...by.values()].map(({ where, detail, at }) => ({
    where,
    detail,
    views:
      at.length > 3 ? `${at.slice(0, 2).join(" ")} +${String(at.length - 2)} more` : at.join(" "),
  }));
};

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith("--") ? argv.shift() : "";
if (!(command in HELP)) usage(`unknown command "${command}"`, HELP[""]);
if (command === "" && argv.length && !argv.includes("--help"))
  usage("name a command first", HELP[""]);
if (argv.includes("--help") || command === "") {
  say([HELP[command]]);
  process.exit(0);
}
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) positional.push(a);
  else if (!FLAGS[command].includes(a.slice(2))) usage(`unknown flag ${a}`, HELP[command]);
  else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--"))
    usage(`${a} needs a value`, HELP[command]);
  else flags[a.slice(2)] = argv[++i];
}

await sheet();

async function sheet() {
  let base;
  try {
    base = new URL(positional[0] ?? "");
  } catch {
    base = null;
  }
  if (!base || !/^https?:$/.test(base.protocol))
    usage("name the prototype page's URL, like http://localhost:3311/trials", HELP.sheet);
  const urlOf = (key) => {
    const u = new URL(base);
    if (key) u.searchParams.set("variant", key);
    return u.href;
  };
  /* the site as players see it, in the mock browser's bar */
  const address = "ballestrecords.com" + base.pathname;
  const browser = await launch();
  try {
    let listed;
    try {
      listed = await pickerList(browser, urlOf(null));
    } catch {
      const port = base.hostname === "localhost" ? base.port : "";
      fail(
        `${urlOf(null)} didn't load`,
        port
          ? `serve the prototype: pnpm dev:up ${port}`
          : "check the URL, or wait for the preview",
      );
    }
    const asked = variantsOf(listed, flags);
    if ("error" in asked) fail(`${urlOf(null)}: ${asked.error}`, asked.help);
    const { variants } = asked;
    const now = Date.now();
    const view = async (key, width, options) => {
      const r = await draw(browser, urlOf(key), width, { ...options, now });
      if (r.failed) fail(`${urlOf(key)} at ${String(width)} px: ${r.failed}`);
      if (r.status >= 400) fail(`${urlOf(key)} answered ${String(r.status)}`, "check the URL");
      if (r.missing)
        fail(`no ${options.element} on ${urlOf(key)} at ${String(width)} px`, "check --el");
      return r;
    };
    const drawn = [];
    const errors = [];
    for (const v of variants) {
      const [d, p] = await Promise.all([
        view(v.key, 1280, { element: flags.el }),
        view(v.key, 390, { element: flags.el }),
      ]);
      for (const [r, width] of [
        [d, 1280],
        [p, 390],
      ])
        errors.push(...r.errors.map((e) => ({ variant: v.key, width, ...e })));
      drawn.push({ v, desktop: d.shot, phone: p.shot });
    }
    /* with --el, the pick (or the first) once as the whole page too, down to the feature's
       end, to show where it sits */
    let inPage = null;
    if (flags.el) {
      const v = variants.find((x) => x.key === flags.pick) ?? variants[0];
      const [d, p] = await Promise.all([
        view(v.key, 1280, { box: flags.el }),
        view(v.key, 390, { box: flags.el }),
      ]);
      inPage = { v, desktop: d.shot, phone: p.shot, desktopUpTo: d.ends, phoneUpTo: p.ends };
    }
    const dir = OUT + "sheet/";
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const images = [];
    const write = (variant, name, jpeg) => {
      writeFileSync(dir + name, jpeg);
      if (flags.out) {
        mkdirSync(flags.out, { recursive: true });
        writeFileSync(resolvePath(flags.out, name), jpeg);
      }
      images.push({ variant, file: flags.out ? resolvePath(flags.out, name) : rel(dir + name) });
    };
    const title = flags.title ?? base.pathname;
    write(
      "all",
      "overview.jpg",
      await compose(browser, overviewHtml(drawn, { pick: flags.pick, title, address })),
    );
    if (inPage)
      write(
        "in page",
        "page.jpg",
        await compose(
          browser,
          cardHtml(inPage.v, inPage, {
            pick: inPage.v.key === flags.pick,
            badge: "in the page",
            address,
          }),
        ),
      );
    for (const d of drawn)
      write(
        d.v.key,
        `variant-${d.v.key}.jpg`,
        await compose(browser, cardHtml(d.v, d, { pick: d.v.key === flags.pick, title, address })),
      );
    say([
      `sheet: ${base.href}, ${String(variants.length)} variant${variants.length === 1 ? "" : "s"}`,
      ...rows("images", ["variant", "file"], images),
      ...rows("errors", ["where", "detail", "views"], sameErrors(errors)),
      "next:",
      `  read ${images[0].file}   # the overview, to check the shots came out`,
      `  attach the overview${inPage ? ", page.jpg" : ""} and the cards to the round's message (6 files a message: the overview first)`,
    ]);
  } finally {
    await browser.close();
  }
}
