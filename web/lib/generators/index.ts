// The Generators (CONTEXT.md; specs #299 and #310): useful things, course pieces, decor, trees
// and buildings, each making a Prefab file from a few settings. A Generator is its category,
// controls, defaults and builder; the page draws whatever controls() returns, so a new
// Generator is one entry in GENERATORS.
// Settled on the never-merged branches claude/prototype-prefab-generators and
// claude/prototype-make-your-own.
//
// Pieces are the editor's primitives, placed by their bottom centre (lib/prefab-meshes.ts has
// their bounds): a cube 1000 cm, a sphere 400 cm, a cylinder 1000 cm across and 200 tall, a
// cone 300 across and 200 tall, a pyramid 500 across its corners and 200 tall. Rotations are
// Unreal's [pitch, yaw, roll] in degrees. A sign or a building faces -X (a sign
// reads left to right along +Y): spawnprefab puts a Prefab in front of the editor's camera,
// which looks along +X with +Y on its right, so it faces whoever spawned it (checked in game).
import { PIXEL_LETTERING, type Lettering } from "../generator-letters";
import { castle, house, tower } from "./buildings";
import { fence, finishArch, fountain, lampPost, trophy } from "./decor";
import { blockTree, bush, pine, tree } from "./nature";
import type { Generator, Values } from "./pieces";
import { jump, loop, plinko, rollers, spiral } from "./racing";
import { sign } from "./signs";
import { arrowSign, bridge, floorTiles, pixelArt, stairs } from "./useful";

export type { Grid, Lettering } from "../generator-letters";
export { PIXEL_LETTERING } from "../generator-letters";
export {
  CATEGORIES,
  COLOURS,
  COLOUR_NAMES,
  PIECE_LIMIT,
  SPAWN_MOST,
  spawnsOf,
  rects,
  type Colour,
  type Control,
  type Generator,
  type Values,
} from "./pieces";
export { fitText } from "./signs";
export { VOXEL_KINDS, voxelBoxes, voxelTree } from "./nature";
export { MARBLE, PICTURE_MOST, pictureOf, readPicture } from "./useful";
export { rotOf } from "./pieces";

export const GENERATORS: ReadonlyArray<Generator> = [
  sign,
  arrowSign,
  pixelArt,
  stairs,
  bridge,
  floorTiles,
  spiral,
  loop,
  jump,
  plinko,
  rollers,
  lampPost,
  fountain,
  trophy,
  fence,
  finishArch,
  tree,
  pine,
  blockTree,
  bush,
  house,
  tower,
  castle,
];
export const generatorOf = (key: string) => GENERATORS.find((g) => g.key === key) ?? null;

/* a control's unit as its value is shown: ° and % close up, the rest after a space */
export const unitOf = (unit?: string) =>
  !unit ? "" : unit === "°" || unit === "%" ? unit : " " + unit;

/* the variations the collage (/prefabs/collage) draws a Generator in, each a label and its
   whole values, one change from its defaults: the defaults, then every number at its least and
   its most, every choice's options and every switch flipped, for the controls the defaults show
   (or only those in `only`) */
export function variationsOf(
  g: Generator,
  only?: Array<string>,
): Array<{ label: string; values: Values }> {
  const changes: Array<[string, Values]> = [["defaults", {}]];
  for (const c of g.controls(g.defaults)) {
    if (only && !only.includes(c.key)) continue;
    if (c.kind === "number")
      for (const n of [c.min, c.max])
        changes.push([`${c.label} ${String(n)}${unitOf(c.unit)}`, { [c.key]: n }]);
    else if (c.kind === "choice")
      for (const o of c.options) changes.push([`${c.label} ${o}`, { [c.key]: o }]);
    else if (c.kind === "toggle")
      changes.push([
        `${c.label} ${g.defaults[c.key] ? "off" : "on"}`,
        { [c.key]: !g.defaults[c.key] },
      ]);
  }
  return changes.map(([label, change]) => ({ label, values: { ...g.defaults, ...change } }));
}

/* the Prefab file `key` makes from these values, or null when there is nothing to make (no
   text); a sign in a drawn font takes the lettering that draws it, else the Pixel font's */
export function generate(key: string, values: Values, lettering: Lettering = PIXEL_LETTERING) {
  return generatorOf(key)?.build(values, lettering) ?? null;
}
