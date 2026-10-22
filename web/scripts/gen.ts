// `pnpm --silent gen`: checking the Prefab Generators, for agents (follows the agent-tools
// skill: live state when run bare, compact rows, only what is wrong, a next step after every
// answer, errors on stdout with exit code 1). `check` makes every Generator's file in every
// variation the collage draws and prints only the faults; `collage` draws the pictures for the
// variations that need a look. What each check means: lib/generators/checks.ts.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { extent, faultsOf, parts } from "../lib/generators/checks";
import { GENERATORS, generate, generatorOf, variationsOf } from "../lib/generators";

const HELP: Record<string, string> = {
  "": `usage: pnpm --silent gen [command] [flags]
  (none)    every Generator at its defaults: size, pieces, parts
  check     every variation of the Generators, only what is wrong
  collage   the pictures of one Generator's variations, as one JPEG
run \`pnpm --silent gen <command> --help\` for a command's flags`,
  check: `usage: pnpm --silent gen check [key ...] [--only control,control]
  makes each Generator's file in every variation the collage lists (the defaults, each number
  at its least and most, each option, each switch) and prints the ones with a fault:
  empty (made nothing), over (past the game's 4096 pieces), floor (a piece more than 30 cm
  under z = 0), parts (more separate pieces of build than the defaults make)
  key      Generators to check (default all)
  --only   limit a Generator to these controls
examples:
  pnpm --silent gen check
  pnpm --silent gen check bridge spiral --only span,rise`,
  collage: `usage: pnpm --silent gen collage <key> [--only control,control] [--at http://localhost:3000]
  draws the Generator's collage (every variation, from the front, back and above) into
  scratch/collage/<key>.jpg and prints its path, then the variations with faults; needs the
  site running (pnpm dev:up <port>)
examples:
  pnpm --silent gen collage fountain
  pnpm --silent gen collage tower --only crown,shape --at http://localhost:3001`,
};

const cmd = process.argv.at(2);
const rest = process.argv.slice(3);
const flags = new Map<string, string>();
const args: Array<string> = [];
for (let i = 0; i < rest.length; i++)
  if (rest[i].startsWith("--")) flags.set(rest[i], rest[i] === "--help" ? "" : (rest[++i] ?? ""));
  else args.push(rest[i]);

const quote = (s: string) => (/[,:"]/.test(s) ? JSON.stringify(s) : s);
const row = (...cells: Array<string | number>) =>
  "  " + cells.map((c) => quote(String(c))).join(",");
function usage(message: string): never {
  console.log(`error: ${message}\n${HELP[cmd && cmd in HELP ? cmd : ""]}`);
  process.exit(2);
}
if (cmd && !(cmd in HELP)) usage(`unknown command ${cmd}`);
if (flags.has("--help")) {
  console.log(HELP[cmd ?? ""]);
  process.exit(0);
}
for (const f of flags.keys())
  if (
    !["--only", "--at"].includes(f) ||
    (f === "--at" && cmd !== "collage") ||
    (f === "--only" && cmd === undefined)
  )
    usage(`unknown flag ${f} for ${cmd ?? "home"}`);

const only = flags.get("--only")?.split(",");
const pick = (keys: Array<string>) =>
  keys.length ? keys.map((k) => generatorOf(k) ?? usage(`no Generator ${k}`)) : [...GENERATORS];

/* the variations with faults, per Generator */
function faults(keys: Array<string>) {
  const out: Array<[string, string, string, string]> = [];
  let checked = 0;
  for (const g of pick(keys)) {
    const base = generate(g.key, g.defaults);
    const n = base ? parts(base) : 1;
    for (const { label, values } of variationsOf(g, only)) {
      checked++;
      for (const f of faultsOf(generate(g.key, values), g.loose ? Infinity : n))
        out.push([g.key, label, f.kind, f.detail]);
    }
  }
  return { out, checked };
}

if (cmd === undefined) {
  console.log(`generators[${String(GENERATORS.length)}]{key,category,pieces,parts,size,high_m}:`);
  for (const g of GENERATORS) {
    const f = generate(g.key, g.defaults);
    if (!f) console.log(row(g.key, g.category, 0, 0, "-", "-"));
    else {
      const e = extent(f);
      console.log(
        row(
          g.key,
          g.category,
          f.items.length,
          parts(f),
          `${e.x.toFixed(1)}x${e.y.toFixed(1)}`,
          e.high.toFixed(1),
        ),
      );
    }
  }
  console.log(`help[2]:\n  pnpm --silent gen check\n  pnpm --silent gen collage <key>`);
} else if (cmd === "check") {
  const { out, checked } = faults(args);
  if (!out.length)
    console.log(
      `faults: none in ${String(checked)} variations of ${String(pick(args).length)} Generators`,
    );
  else {
    console.log(`faults[${String(out.length)}]{generator,variation,kind,detail}:`);
    for (const r of out) console.log(row(...r));
    console.log(
      `checked: ${String(checked)} variations\nhelp[1]:\n  pnpm --silent gen collage ${out[0][0]}`,
    );
  }
  process.exit(out.length ? 1 : 0);
} else {
  const key = args[0] ?? usage("collage needs a Generator key");
  const g = generatorOf(key) ?? usage(`no Generator ${key}`);
  const at = flags.get("--at") ?? "http://localhost:3000";
  const dir = "scratch/collage";
  const run = spawnSync(
    "node",
    [
      resolve("../.claude/skills/prefab-generators/collage.mjs"),
      at,
      resolve("..", dir),
      only ? `${g.key}:${only.join(",")}` : g.key,
    ],
    { cwd: resolve(".."), encoding: "utf8" },
  );
  const file = run.stdout.trim().split("\n").at(-1) ?? "";
  if (run.status !== 0 || !file) {
    console.log(
      `error: the collage did not draw (is the site up at ${at}?)\nhelp[1]:\n  pnpm dev:up 3000`,
    );
    process.exit(1);
  }
  console.log(`collage: ${file}`);
  const { out } = faults([g.key]);
  console.log(
    out.length
      ? `faults[${String(out.length)}]{variation,kind,detail}:\n${out.map((r) => row(r[1], r[2], r[3])).join("\n")}`
      : "faults: none",
  );
}
