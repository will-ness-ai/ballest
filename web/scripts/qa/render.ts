// The Node half of `qa render` (scripts/qa.mjs runs it under tsx): draws a Prefab file, or what a
// Generator makes from its defaults and --set values, through the share images' GPU-free
// rasterizer (components/share/prefab.ts), so a file or a Generator's output can be looked at
// without a page or a deploy. Its arguments come as one JSON string; it prints one JSON line.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { prefabPicture } from "../../components/share/prefab";
import { generate, generatorOf, isPieceFont } from "../../lib/generators";
import { shapesOf, spanOf, type PrefabFile } from "../../lib/prefab";
import { checkPrefab } from "../../lib/prefab-check";
import { DEFAULT_ANGLE, checkAngle, type PrefabAngle } from "../../lib/prefabs";

interface Args {
  what: string;
  set: Array<string>;
  items?: string;
  from?: string;
  size?: string;
  out: string;
}
type Vec3 = [number, number, number];
/* the largest picture side, px: the rasterizer holds every pixel several times over */
const MOST = 4000;

/* the named views, as from-directions in three's axes (y up): a sign faces -X */
const VIEWS: Partial<Record<string, Vec3>> = {
  top: [0, 1, 0.0001],
  front: [-1, 0.0001, 0],
  side: [0, 0.0001, -1],
};

const args = JSON.parse(process.argv[2] ?? "{}") as Args;
function done(result: Record<string, unknown>): never {
  console.log(JSON.stringify(result));
  process.exit(0);
}
function fail(error: string): never {
  return done({ error });
}

/* a --set value as its default holds it: a number, a switch or text */
function valueOf(key: string, v: string, like: unknown) {
  if (typeof like === "number") {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : fail(`${key} takes a number, not "${v}"`);
  }
  if (typeof like === "boolean")
    return v === "true" || v === "false" ? v === "true" : fail(`${key} takes true or false`);
  return v;
}

/* "0-5,9" as the places it names, up to `most`; null when it isn't such a list */
function placesOf(spec: string, most: number) {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const [, from, to] = m as unknown as [string, string, string | undefined];
    const a = Number(from);
    const b = Math.min(Number(to ?? from), most);
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out;
}

let file: PrefabFile;
let angle: PrefabAngle | null = null;
const notes: Array<string> = [];
/* a file of that name first, so a Prefab saved as "sign" is still read */
const g = existsSync(args.what) ? null : generatorOf(args.what);
if (g) {
  const values = { ...g.defaults };
  for (const s of args.set) {
    const at = s.indexOf("=");
    if (at < 1) fail(`--set takes key=value, not "${s}"`);
    const key = s.slice(0, at);
    if (!(key in values))
      fail(`${g.key} has no "${key}"; its keys: ${Object.keys(values).join(" ")}`);
    values[key] = valueOf(key, s.slice(at + 1), values[key]);
  }
  if (g.lettered && values.font !== "Pixel" && !isPieceFont(values.font))
    notes.push(`the font "${String(values.font)}" is drawn by a browser, so this letters in Pixel`);
  const made = generate(g.key, values);
  file = made ?? fail(`${g.key} makes nothing from these values`);
  angle = g.angle ?? null;
} else {
  let text = "";
  try {
    text = readFileSync(args.what, "utf8");
  } catch {
    fail(`"${args.what}" is neither a Generator nor a readable file`);
  }
  const check = checkPrefab(text);
  if (!check.ok) fail(`not a Prefab the game takes: ${check.problems.join(" ")}`);
  file = JSON.parse(text) as PrefabFile;
}
const total = file.items.length;
if (args.items) {
  const keep = placesOf(args.items, total - 1);
  if (!keep) fail(`--items takes places and ranges, e.g. 0-5,9, not "${args.items}"`);
  file = { ...file, items: file.items.filter((_, i) => keep.has(i)) };
  if (!file.items.length) fail(`--items keeps none of the ${String(total)} pieces`);
}
if (args.from) {
  const named = VIEWS[args.from];
  const given = args.from.split(",").map(Number);
  const typed =
    given.length === 3 && args.from.split(",").every((p) => p.trim() !== "")
      ? checkAngle({ ...DEFAULT_ANGLE, from: given })
      : null;
  const from = named ?? typed?.from;
  if (!from)
    fail(
      `--from takes top, front, side or x,y,z (three's axes, y up, not all 0), not "${args.from}"`,
    );
  /* straight down or up has no right way round: nudged, as the named views are */
  angle = {
    ...DEFAULT_ANGLE,
    from: Math.hypot(from[0], from[2]) < 1e-4 ? [from[0], from[1], 1e-4] : from,
  };
}
const size = /^(\d+)x(\d+)$/.exec(args.size ?? "1200x800");
const [w, h] = [Number(size?.[1]), Number(size?.[2])];
if (!(w > 0 && h > 0 && w <= MOST && h <= MOST))
  fail(`--size takes WxH in whole px up to ${String(MOST)}, not "${String(args.size)}"`);

writeFileSync(args.out, await prefabPicture(file, angle, w, h));
/* how far it reaches, in Unreal's axes and cm */
const shapes = shapesOf(file);
const reach = [0, 2, 1].map((k) => {
  const spans = shapes.map((sh) => spanOf(sh, k));
  return [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))].map((v) =>
    Math.round(v * 100),
  );
});
done({ pieces: file.items.length, of: total, reach, notes });
