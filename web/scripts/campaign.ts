// `pnpm --silent campaign`: adding a Campaign, for agents. It follows the agent-tools skill
// (.claude/skills/agent-tools): live state when run bare, rows, only what is wrong, a next
// step after every answer, everything on stdout, exit 1 for a failure and 2 for a usage
// error. `draft` runs the add-campaign skill's first two steps in one call; `check` its
// look at the page. The pure half is scripts/campaign/draft.ts.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CAMPAIGNS, type Campaign } from "../lib/campaigns";
import {
  cell,
  entryText,
  type Found,
  insertEntry,
  rows,
  sharedTitle,
  slugOf,
} from "./campaign/draft";
import { campaignHref } from "../lib/routes";
import { resolve } from "./qa/targets.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CAMPAIGNS_TS = fileURLToPath(new URL("../lib/campaigns.ts", import.meta.url));

const HELP: Record<string, string> = {
  draft: `usage: pnpm --silent campaign draft <query ...> [--title <title>] [--slug <slug>] [--write]
  Finds the Maps (tools/workshop_maps.py: Workshop links or IDs, a whole pasted post, a
  collection, or a maker's profile URL, SteamID64 or name), labels each as the Campaign's rail
  will, flags what is wrong, and prints the entry for web/lib/campaigns.ts.
  --title   the Campaign's title (default: the words every Map's title starts with)
  --slug    its path (default: the title as lowercase words joined by -)
  --write   append the entry to CAMPAIGNS ((no-op) when the same entry is there)
examples:
  pnpm --silent campaign draft "https://steamcommunity.com/sharedfiles/filedetails/?id=3820698656 ..."
  pnpm --silent campaign draft 76561198042310114 --title "Limbo campaign" --slug limbo --write`,
  check: `usage: pnpm --silent campaign check <slug> [--at prod|preview|<url>]
  Which of the Campaign's Maps its page shows, on production or a preview.
  --at   the site (default prod)
examples:
  pnpm --silent campaign check limbo
  pnpm --silent campaign check limbo --at preview`,
};
const FLAGS: Record<string, Array<string>> = {
  draft: ["--title", "--slug", "--write"],
  check: ["--at"],
};
const SWITCHES = new Set(["--write"]);

const out = (lines: Array<string>) => console.log(lines.join("\n"));
const help = (cmds: Array<string>) => [
  `help[${String(cmds.length)}]:`,
  ...cmds.map((c) => `  ${c}`),
];
function fail(message: string, next: Array<string>, code = 1): never {
  out([`error: ${message}`, ...help(next)]);
  process.exit(code);
}

/* the command's positional arguments and flags, or a usage error naming what it doesn't know */
function parse(cmd: string, args: Array<string>) {
  const pos: Array<string> = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    if (a === "--help") {
      out([HELP[cmd]]);
      process.exit(0);
    }
    if (!FLAGS[cmd].includes(a))
      fail(
        `unknown flag ${a} for ${cmd}; it takes ${FLAGS[cmd].join(", ")}`,
        [`pnpm --silent campaign ${cmd} --help`],
        2,
      );
    if (SWITCHES.has(a)) flags[a] = true;
    else if (i + 1 >= args.length || args[i + 1].startsWith("--"))
      fail(`${a} needs a value`, [`pnpm --silent campaign ${cmd} --help`], 2);
    else flags[a] = args[++i];
  }
  return { pos, flags };
}

function home() {
  const newest = CAMPAIGNS.slice(-3).map((c) => `${c.slug} (${String(c.maps.length)} Maps)`);
  out([
    `campaigns: ${String(CAMPAIGNS.length)}, newest ${newest.join(", ")}`,
    "commands:",
    "  draft <query ...>   find a Campaign's Maps, label them, print or --write the entry",
    "  check <slug>        which of its Maps the site's page shows",
    ...help([
      'pnpm --silent campaign draft "<Workshop links, post, collection or maker>"',
      `pnpm --silent campaign check ${CAMPAIGNS.at(-1)?.slug ?? "<slug>"}`,
    ]),
  ]);
}

/* the Maps a query finds, through workshop_maps.py; `again` is the command to run it again */
function find(query: string, again: string): { maps: Array<Found>; missing: Array<string> } {
  let raw: string;
  try {
    raw = execFileSync("python3", [`${ROOT}tools/workshop_maps.py`, "--json", query], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    raw = (e as { stdout?: string }).stdout ?? "";
  }
  let report: { maps?: Array<Found>; missing?: Array<string>; error?: string };
  try {
    report = JSON.parse(raw) as typeof report;
  } catch {
    fail("tools/workshop_maps.py printed no report", [
      `python3 tools/workshop_maps.py ${JSON.stringify(query)}`,
    ]);
  }
  if (report.error !== undefined)
    fail(
      report.error,
      report.error.startsWith("couldn't reach")
        ? [`${again}   # try again`]
        : ['pnpm --silent campaign draft "<other links, or the maker\'s profile URL>"'],
    );
  return { maps: report.maps ?? [], missing: report.missing ?? [] };
}

function draft(args: Array<string>) {
  const { pos, flags } = parse("draft", args);
  if (!pos.length) fail("draft needs a query", ["pnpm --silent campaign draft --help"], 2);
  const { maps, missing } = find(
    pos.join(" "),
    `pnpm --silent campaign draft ${args.map((a) => (a.startsWith("--") ? a : JSON.stringify(a))).join(" ")}`,
  );
  const title =
    typeof flags["--title"] === "string" ? flags["--title"] : sharedTitle(maps.map((m) => m.title));
  if (title === null)
    fail("the Maps' titles share no words to name it by", [
      `pnpm --silent campaign draft ${pos.map((p) => JSON.stringify(p)).join(" ")} --title "<title>"`,
    ]);
  const slug = typeof flags["--slug"] === "string" ? flags["--slug"] : slugOf(title);
  const makers = new Map(maps.map((m) => [m.cid, m.creator]));
  // the maker of most of the Maps; the others show as flags on their rows
  const counts = [...makers.keys()].map(
    (cid) => [cid, maps.filter((m) => m.cid === cid).length] as const,
  );
  const [cid] = counts.sort((a, b) => b[1] - a[1])[0];
  const c: Campaign = {
    slug,
    title,
    creator: makers.get(cid) ?? "",
    creatorId: cid,
    maps: maps.map((m) => m.pfid),
  };

  const added = CAMPAIGNS.find((x) => x.maps.join() === c.maps.join());
  if (added) {
    out([
      `campaign: these Maps are already ${added.title} (${added.slug}) (no-op)`,
      ...help([`pnpm --silent campaign check ${added.slug}`]),
    ]);
    return;
  }
  const table = rows(c, maps);
  const problems = table
    .filter((r) => r.problems.length)
    .map((r) => `${r.no} ${r.pfid}: ${r.problems.join(", ")}`);
  const taken = CAMPAIGNS.find((x) => x.slug === slug);
  if (taken) problems.push(`slug "${slug}" is ${taken.title}'s`);
  const notes = [
    ...missing.map(
      (id) => `${id}: no Map (not this game's, not public, or newer than Steam's catalogue)`,
    ),
    ...table.filter((r) => r.notes.length).map((r) => `${r.no} ${r.pfid}: ${r.notes.join(", ")}`),
  ];
  const elsewhere = CAMPAIGNS.find((x) => x.creatorId === cid);
  if (elsewhere)
    notes.push(
      `${c.creator} also made ${elsewhere.slug}: share their creator fields as a constant`,
    );
  const entry = entryText(c);
  const query = pos.map((p) => JSON.stringify(p)).join(" ");

  const lines = [
    `campaign: ${title} (${slug}) by ${c.creator} (${cid}), ${String(maps.length)} Maps`,
    `maps[${String(table.length)}]{no,pfid,label,title}:`,
    ...table.map((r) => [r.no, r.pfid, r.label, r.title].map(cell).join(",")),
    problems.length ? `problems[${String(problems.length)}]:` : "problems: none",
    ...problems.map((p) => `  ${p}`),
    ...(notes.length ? [`notes[${String(notes.length)}]:`, ...notes.map((n) => `  ${n}`)] : []),
  ];
  if (problems.length) {
    out([
      ...lines,
      flags["--write"]
        ? "entry: not written while there are problems"
        : "entry: none while there are problems",
      ...help([
        ...(taken
          ? [
              `pnpm --silent campaign draft ${query} --title ${JSON.stringify(title)} --slug <another slug>`,
            ]
          : []),
        ...(problems.length > (taken ? 1 : 0)
          ? ['pnpm --silent campaign draft "<the links without Maps another Campaign has>"']
          : []),
      ]),
    ]);
    process.exit(1);
  }
  if (!flags["--write"]) {
    out([
      ...lines,
      "entry:",
      entry,
      ...help([
        `pnpm --silent campaign draft ${query} --title ${JSON.stringify(title)} --slug ${slug} --write`,
      ]),
    ]);
    return;
  }
  const next = insertEntry(readFileSync(CAMPAIGNS_TS, "utf8"), entry);
  if (next === null)
    fail("can't find the end of CAMPAIGNS in web/lib/campaigns.ts", ["read web/lib/campaigns.ts"]);
  writeFileSync(CAMPAIGNS_TS, next);
  try {
    // for what entryText's layout doesn't cover, such as a title holding a quote
    execFileSync("pnpm", ["exec", "prettier", "--write", CAMPAIGNS_TS], {
      cwd: ROOT,
      stdio: "ignore",
    });
  } catch {
    lines.push("prettier: couldn't run; pnpm check will say what to format");
  }
  out([
    ...lines,
    "entry: appended to CAMPAIGNS in web/lib/campaigns.ts",
    ...help([
      "pnpm check",
      "cd web && npx vitest run test/campaigns.test.ts",
      `pnpm --silent campaign check ${slug} --at preview`,
    ]),
  ]);
}

async function check(args: Array<string>) {
  const { pos, flags } = parse("check", args);
  const slug = pos.at(0);
  if (slug === undefined) fail("check needs a slug", ["pnpm --silent campaign check --help"], 2);
  const c = CAMPAIGNS.find((x) => x.slug === slug);
  if (c === undefined)
    fail(`no Campaign "${slug}" in web/lib/campaigns.ts`, [
      `pnpm --silent campaign check ${CAMPAIGNS.at(-1)?.slug ?? "<slug>"}`,
      'pnpm --silent campaign draft "<query>" --write',
    ]);
  const at = resolve(typeof flags["--at"] === "string" ? flags["--at"] : "prod") as {
    name: string;
    url: string;
    state?: string;
  } | null;
  if (at === null)
    fail(`--at takes prod, preview or a URL`, ["pnpm --silent campaign check --help"], 2);
  if (at.name === "preview" && at.state !== "success")
    fail(`the preview is ${at.state ?? "not deployed"}`, [
      "git push",
      `pnpm --silent campaign check ${slug} --at preview`,
    ]);
  let html: string;
  try {
    const res = await fetch(at.url + campaignHref(slug), { signal: AbortSignal.timeout(30_000) });
    if (!res.ok)
      fail(`${at.name} answered ${String(res.status)} for ${campaignHref(slug)}`, [
        `pnpm --silent campaign check ${slug} --at ${at.name}   # once a deploy carries the entry`,
      ]);
    html = await res.text();
  } catch (e) {
    fail(`couldn't reach ${at.name}: ${(e as Error).message}`, [
      `pnpm --silent campaign check ${slug} --at ${at.name}`,
    ]);
  }
  const shown = new Set(
    [...html.matchAll(new RegExp(`${campaignHref(slug)}/(\\d+)`, "g"))].map((m) => m[1]),
  );
  const absent = c.maps.filter((p) => !shown.has(p));
  const lines = [
    `page: ${at.url}${campaignHref(slug)}`,
    `shown: ${String(c.maps.length - absent.length)} of ${String(c.maps.length)} Maps`,
  ];
  if (!absent.length) return out(lines);
  out([
    ...lines,
    `missing[${String(absent.length)}]{no,pfid}:`,
    ...absent.map((p) => `${String(c.maps.indexOf(p) + 1).padStart(2, "0")},${p}`),
    ...help([
      "gh workflow run refresh.yml --ref main   # a Refresh lists Maps published since the last one",
      `pnpm --silent campaign check ${slug} --at ${at.name}`,
    ]),
  ]);
  process.exit(1);
}

const argv = process.argv.slice(2);
const cmd = argv.at(0);
const rest = argv.slice(1);
if (cmd === undefined) home();
else if (cmd === "draft") draft(rest);
else if (cmd === "check") await check(rest);
else if (cmd === "--help") home();
else
  fail(`unknown command ${cmd}; the commands are draft and check`, ["pnpm --silent campaign"], 2);
