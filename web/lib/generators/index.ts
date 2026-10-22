// The Generators (CONTEXT.md; specs #299 and #310): signs, trees and buildings, each making a
// Prefab file from a few settings. A Generator is its category, controls, defaults and builder;
// the page draws whatever controls() returns, so a new Generator is one entry in GENERATORS.
// Settled on the never-merged branches claude/prototype-prefab-generators and
// claude/prototype-make-your-own.
//
// Pieces are the editor's primitives, placed by their bottom centre (lib/prefab-meshes.ts has
// their bounds): a cube 1000 cm, a sphere 400 cm, a cylinder 1000 cm across and 200 tall, a
// cone 300 across and 200 tall, a pyramid 500 across its corners and 200 tall. Rotations are
// Unreal's [pitch, yaw, roll] in degrees. A sign, a QR code or a building faces -X (a sign
// reads left to right along +Y): spawnprefab puts a Prefab in front of the editor's camera,
// which looks along +X with +Y on its right, so it faces whoever spawned it (checked in game).
import { PIXEL_LETTERING, type Lettering } from "../generator-letters";
import { castle, house, tower } from "./buildings";
import { blockTree, bush, pine, tree } from "./nature";
import type { Generator, Values } from "./pieces";
import { qr, sign } from "./signs";

export type { Grid, Lettering } from "../generator-letters";
export { PIXEL_LETTERING } from "../generator-letters";
export {
  CATEGORIES,
  COLOURS,
  COLOUR_NAMES,
  PIECE_LIMIT,
  rects,
  type Colour,
  type Control,
  type Generator,
  type Values,
} from "./pieces";
export { fitText } from "./signs";
export { VOXEL_KINDS, voxelBoxes, voxelTree } from "./nature";

export const GENERATORS: ReadonlyArray<Generator> = [
  qr,
  sign,
  tree,
  pine,
  blockTree,
  bush,
  house,
  tower,
  castle,
];
export const generatorOf = (key: string) => GENERATORS.find((g) => g.key === key) ?? null;

/* the variations the collage (/prefabs/collage) draws a Generator in, each a label and the one
   change from its defaults: the defaults, then every number at its least and its most, every
   choice's options and every switch flipped, for the controls the defaults show (or `only`) */
export function variationsOf(g: Generator, only?: Array<string>): Array<[string, Values]> {
  const rows: Array<[string, Values]> = [["defaults", {}]];
  for (const c of g.controls(g.defaults)) {
    if (only && !only.includes(c.key)) continue;
    const unit =
      c.kind === "number" && c.unit
        ? c.unit === "°" || c.unit === "%"
          ? c.unit
          : " " + c.unit
        : "";
    if (c.kind === "number")
      for (const n of [c.min, c.max]) rows.push([`${c.label} ${String(n)}${unit}`, { [c.key]: n }]);
    else if (c.kind === "choice")
      for (const o of c.options) rows.push([`${c.label} ${o}`, { [c.key]: o }]);
    else if (c.kind === "toggle")
      rows.push([
        `${c.label} ${g.defaults[c.key] ? "off" : "on"}`,
        { [c.key]: !g.defaults[c.key] },
      ]);
  }
  return rows;
}

/* the Prefab file `key` makes from these values, or null when there is nothing to make (no
   text); a sign in a drawn font takes the lettering that draws it, else the Pixel font's */
export function generate(key: string, values: Values, lettering: Lettering = PIXEL_LETTERING) {
  return generatorOf(key)?.build(values, lettering) ?? null;
}
