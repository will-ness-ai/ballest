// A Prefab file (CONTEXT.md) read into the shapes
// the viewer draws. A BallestPrefab file names each piece's mesh, material and transform
// but carries no geometry, so each mesh the editor's pieces use is a stand-in shape here,
// sized from the mesh's bounds (cm, pivot at the bottom centre). An unknown mesh is a grey box.
// The bounds are lib/prefab-meshes.ts; the game's meshes stay out of the repo (ADR 0001).

import { MESHES, PIECE_MESHES } from "./prefab-meshes";

export interface PrefabFile {
  format: "BallestPrefab";
  version: number;
  group: { rotation: Vec3; scale: Vec3 };
  items: Array<PrefabItem>;
}

type Vec3 = [number, number, number];

export interface PrefabItem {
  class: string;
  transform: { location: Vec3; rotation: Vec3; scale: Vec3 };
  meshes: Array<{ mesh: string; materials: Array<string> }>;
  paint?: { categories: Array<string>; colors: Array<number> };
}

export type ShapeKind = "box" | "cylinder" | "sphere" | "scoop" | "halfRing" | "quarterRing";

export interface MeshShape {
  kind: ShapeKind;
  min: Vec3;
  max: Vec3;
}

/* the material's own colour word, as the editor's swatches show it */
const COLOURS: Array<[RegExp, string]> = [
  [/Lime/i, "#9be22d"],
  [/White/i, "#e8ecf2"],
  [/Dark/i, "#3a3f4b"],
  [/Concrete/i, "#9a9a96"],
  [/Red/i, "#d8433a"],
  [/Blue/i, "#3f7fe0"],
  [/Yellow/i, "#f2cc3a"],
  [/Orange/i, "#ef8a2f"],
  [/Purple/i, "#9a5ae0"],
  [/Pink/i, "#e96aa8"],
  [/Green/i, "#3fae5a"],
  [/Black/i, "#202329"],
];

export interface Shape {
  kind: ShapeKind;
  /** the stand-in's own size in metres, along three's x, y (up), z */
  size: Vec3;
  /** column-major 4x4, local unit shape (centred at the origin) to three world, metres */
  matrix: Array<number>;
  colour: string;
  piece: string;
  material: string;
}

const tail = (path: string) => path.split(/[./]/).at(-1) ?? path;

export function pieceName(item: PrefabItem) {
  return tail(item.class).replace(/_C$/, "");
}

/* Unreal's FRotator [pitch, yaw, roll] in degrees, as the three axes it sends local x, y, z to */
function rotationRows([pitch, yaw, roll]: Vec3): [Vec3, Vec3, Vec3] {
  const r = Math.PI / 180;
  const [sp, cp] = [Math.sin(pitch * r), Math.cos(pitch * r)];
  const [sy, cy] = [Math.sin(yaw * r), Math.cos(yaw * r)];
  const [sr, cr] = [Math.sin(roll * r), Math.cos(roll * r)];
  return [
    [cp * cy, cp * sy, sp],
    [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, -sr * cp],
    [-(cr * sp * cy + sr * sy), cy * sr - cr * sp * sy, cr * cp],
  ];
}

export function shapesOf(file: PrefabFile): Array<Shape> {
  return file.items.map((item) => {
    const mesh = item.meshes.at(0);
    const named = PIECE_MESHES[pieceName(item)];
    const shape: MeshShape = (mesh && MESHES[tail(mesh.mesh)]) ??
      (named ? MESHES[named] : undefined) ?? {
        kind: "box",
        min: [-50, -50, 0],
        max: [50, 50, 100],
      };
    const first = mesh?.materials.at(0);
    const material = first ? tail(first) : "";
    const { location, rotation, scale } = item.transform;
    const rows = rotationRows(rotation);
    const centre = shape.min.map((lo, i) => (lo + shape.max[i]) / 2) as Vec3;
    const ext = shape.max.map((hi, i) => hi - shape.min[i]) as Vec3;
    /* Unreal local axis i -> world: rows[i] * scale[i] * ext[i] (unit shape spans -0.5..0.5) */
    const axis = (i: number) => rows[i].map((v) => v * scale[i] * ext[i]) as Vec3;
    const local = centre.map((c, i) => c * scale[i]) as Vec3;
    const origin = [0, 1, 2].map(
      (k) => location[k] + rows[0][k] * local[0] + rows[1][k] * local[1] + rows[2][k] * local[2],
    ) as Vec3;
    /* Unreal is left-handed, z up; three is right-handed, y up: swapping y and z is both.
       The unit shapes are built along three's axes, so Unreal's local z (up) is three's y. */
    const swap = (v: Vec3): Vec3 => [v[0] / 100, v[2] / 100, v[1] / 100];
    const [ax, ay, az] = [swap(axis(0)), swap(axis(2)), swap(axis(1))];
    const o = swap(origin);
    return {
      kind: shape.kind,
      size: [ext[0] / 100, ext[2] / 100, ext[1] / 100],
      matrix: [...ax, 0, ...ay, 0, ...az, 0, ...o, 1],
      colour: COLOURS.find(([re]) => re.test(material))?.[1] ?? "#8a90a0",
      piece: pieceName(item),
      material,
    };
  });
}

/* a piece's name as a person reads it: "BP_Pipe_Tube1" is Pipe Tube 1, a primitive just Cube */
export function pieceLabel(piece: string) {
  return piece
    .replace(/^BP_(Prim_)?/, "")
    .replace(/_/g, " ")
    .replace(/(\D)(\d+)$/, "$1 $2");
}

/* what the file is made of, most-used piece first */
export function partsOf(file: PrefabFile): Array<{ piece: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of file.items)
    counts.set(pieceName(item), (counts.get(pieceName(item)) ?? 0) + 1);
  return [...counts].map(([piece, count]) => ({ piece, count })).sort((a, b) => b.count - a.count);
}

/* the prefab's size in metres: wide (x), deep (z) and tall (y), over every shape's corners */
export function footprintOf(shapes: Array<Shape>): { w: number; d: number; h: number } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const { matrix: m } of shapes)
    for (const x of [-0.5, 0.5])
      for (const y of [-0.5, 0.5])
        for (const z of [-0.5, 0.5])
          for (let k = 0; k < 3; k++) {
            const v = m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k];
            lo[k] = Math.min(lo[k], v);
            hi[k] = Math.max(hi[k], v);
          }
  return { w: hi[0] - lo[0], d: hi[2] - lo[2], h: hi[1] - lo[1] };
}
