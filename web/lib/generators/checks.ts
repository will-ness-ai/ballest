// What a Generator's Prefab gets wrong that a picture shows only slowly (read by
// scripts/gen.ts): too many pieces, nothing made, a piece under the floor, and how many
// separate parts it is in. Pure, so the tests and the command share it.
import { shapesOf, type PrefabFile } from "../prefab";
import { PIECE_LIMIT } from "./pieces";

/* a piece's box in metres, on three's axes (y up), from its stand-in's matrix: the shape's
   centre and half of each column's reach */
function boxes(file: PrefabFile) {
  return shapesOf(file).map((sh) => {
    const m = sh.matrix;
    const half = [0, 1, 2].map(
      (i) => (Math.abs(m[i]) + Math.abs(m[4 + i]) + Math.abs(m[8 + i])) / 2,
    );
    return {
      lo: [m[12] - half[0], m[13] - half[1], m[14] - half[2]],
      hi: [m[12] + half[0], m[13] + half[1], m[14] + half[2]],
    };
  });
}

/* how many separate parts the pieces make, two pieces being one part when their boxes come
   within `gap` metres of each other */
export function parts(file: PrefabFile, gap = 0.05): number {
  const b = boxes(file)
    .map((x, i) => ({ ...x, i }))
    .sort((p, q) => p.lo[0] - q.lo[0]);
  const root = b.map((_, k) => k);
  const find = (k: number): number => (root[k] === k ? k : (root[k] = find(root[k])));
  for (let a = 0; a < b.length; a++)
    for (let c = a + 1; c < b.length && b[c].lo[0] <= b[a].hi[0] + gap; c++)
      if ([1, 2].every((i) => b[c].lo[i] <= b[a].hi[i] + gap && b[a].lo[i] <= b[c].hi[i] + gap))
        root[find(c)] = find(a);
  return new Set(b.map((_, k) => find(k))).size;
}

/* the lowest and highest a piece's box reaches, and its size across, deep and up, in metres */
export function extent(file: PrefabFile) {
  const b = boxes(file);
  const lo = [0, 1, 2].map((i) => Math.min(...b.map((x) => x.lo[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...b.map((x) => x.hi[i])));
  return { low: lo[1], high: hi[1], x: hi[0] - lo[0], y: hi[2] - lo[2] };
}

export interface Fault {
  kind: "empty" | "over" | "floor" | "parts";
  detail: string;
}

/* what is wrong with one variation's file: `base` is the defaults' part count, so a setting
   that splits a build in two shows up and a gap that is by design does not */
export function faultsOf(file: PrefabFile | null, base: number): Array<Fault> {
  if (!file) return [{ kind: "empty", detail: "made nothing" }];
  const out: Array<Fault> = [];
  if (file.items.length > PIECE_LIMIT)
    out.push({
      kind: "over",
      detail: `${String(file.items.length)} pieces, limit ${String(PIECE_LIMIT)}`,
    });
  const { low } = extent(file);
  if (low < -0.3) out.push({ kind: "floor", detail: `${(-low).toFixed(1)} m under the floor` });
  const n = parts(file);
  if (n > base) out.push({ kind: "parts", detail: `${String(n)} parts, defaults ${String(base)}` });
  return out;
}
