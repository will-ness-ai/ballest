// The Node half of `qa render` (scripts/qa.mjs runs it under tsx): draws a Prefab file, or what a
// Generator makes from its defaults and --set values, through the share images' GPU-free
// rasterizer (components/share/prefab.ts), so a file or a Generator's output can be looked at
// without a page or a deploy. Its arguments come as one JSON string; it prints one JSON line.
import { readFileSync, writeFileSync } from "node:fs";

import { prefabPicture } from "../../components/share/prefab";
import { generate, generatorOf, isPieceFont } from "../../lib/generators";
import { shapesOf, spanOf, type PrefabFile } from "../../lib/prefab";
import { DEFAULT_ANGLE, type PrefabAngle } from "../../lib/prefabs";

interface Args {
  what: string;
  set: Array<string>;
  items?: string;
  from?: string;
  size?: string;
  out: string;
}
type Vec3 = [number, number, number];

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

/* a --set value as the control holds it: a number, a switch or text */
const valueOf = (v: string) =>
  v === "true" ? true : v === "false" ? false : v !== "" && !isNaN(Number(v)) ? Number(v) : v;

/* "0-5,9" as the places it names */
function placesOf(spec: string) {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b = a] = part.split("-").map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out;
}

let file: PrefabFile;
let angle: PrefabAngle | null = null;
const notes: Array<string> = [];
const g = generatorOf(args.what);
if (g) {
  const values = { ...g.defaults };
  for (const s of args.set) {
    const at = s.indexOf("=");
    if (at < 1) fail(`--set takes key=value, not "${s}"`);
    const key = s.slice(0, at);
    if (!(key in values))
      fail(`${g.key} has no "${key}"; its keys: ${Object.keys(values).join(" ")}`);
    values[key] = valueOf(s.slice(at + 1));
  }
  if (g.lettered && values.font !== "Pixel" && !isPieceFont(values.font))
    notes.push(`the font "${String(values.font)}" is drawn by a browser, so this letters in Pixel`);
  const made = generate(g.key, values);
  file = made ?? fail(`${g.key} makes nothing from these values`);
  angle = g.angle ?? null;
} else {
  try {
    file = JSON.parse(readFileSync(args.what, "utf8")) as PrefabFile;
  } catch {
    fail(`"${args.what}" is neither a Generator nor a readable Prefab file`);
  }
}
const total = file.items.length;
if (args.items) {
  const keep = placesOf(args.items);
  if (!keep) fail(`--items takes places and ranges, e.g. 0-5,9, not "${args.items}"`);
  file = { ...file, items: file.items.filter((_, i) => keep.has(i)) };
  if (!file.items.length) fail(`--items keeps none of the ${String(total)} pieces`);
}
if (args.from) {
  const named = VIEWS[args.from];
  const given = args.from.split(",").map(Number);
  const from = named ?? (given.length === 3 && given.every(Number.isFinite) ? given : null);
  if (!from)
    fail(`--from takes top, front, side or x,y,z (three's axes, y up), not "${args.from}"`);
  angle = { ...DEFAULT_ANGLE, from: from as Vec3 };
}
const [w, h] = (args.size ?? "1200x800").split("x").map(Number);
if (!(w > 0 && h > 0)) fail(`--size takes WxH in px, not "${String(args.size)}"`);

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
