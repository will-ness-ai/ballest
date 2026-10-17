// The browser half of `qa piece`, bundled by scripts/qa/piece.mjs: draws one mesh's stand-in
// through the viewer's own scene code from the three views in piece-math.mjs, scores
// each view's outline against the mesh render's, and lays out the sheet a person reads.
import { buildScene, loadThree } from "../../components/prefabs/scene";
import { MESHES } from "../../lib/prefab-meshes";
import { PROFILES } from "../../lib/prefab-profiles";
import type { PrefabFile } from "../../lib/prefab";
import { VIEWS, camera, frameOf, overlap } from "./piece-math.mjs";

type Vec3 = [number, number, number];
/** per view, the mesh render's outline and shaded picture as data URLs */
export type PieceRefs = Partial<Record<string, { mask: string; ortho: string }>>;
export interface PieceResult {
  kind: string;
  /** per view, how well the outlines overlap, 0 to 1; null without a reference */
  scores: Record<string, number> | null;
  /** the sheet as a PNG data URL, when asked for */
  sheet?: string;
}

const SIZE = 512;
const CELL = 256;
const BACKGROUND = 0x14161c;

const three = loadThree();
const renderer = three.then(({ THREE }) => {
  const r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  r.setSize(SIZE, SIZE, false);
  return r;
});

/* Unreal (cm, z up) to three (m, y up), as lib/prefab.ts converts */
const toThree = (v: Vec3): Vec3 => [v[0] / 100, v[2] / 100, v[1] / 100];

async function draw(mesh: string) {
  const shape = MESHES[mesh];
  if (!shape) throw new Error(`no stand-in for ${mesh}`);
  const file: PrefabFile = {
    format: "BallestPrefab",
    version: 1,
    group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
    items: [
      {
        class: mesh,
        transform: { location: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        meshes: [{ mesh, materials: ["MI_Concrete"] }],
      },
    ],
  };
  const t = await three;
  const r = await renderer;
  const { THREE } = t;
  const { scene } = buildScene(t, file, false);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const shots: Record<string, { shaded: string; mask: Uint8Array }> = {};
  for (const v of VIEWS) {
    const { cr, cu, span } = frameOf(shape, v.name);
    const [depth, sign] = v.toward;
    const at: Vec3 = [0, 0, 0];
    at[v.right] = cr;
    at[v.up] = cu;
    at[depth] = sign > 0 ? shape.max[depth] + 1000 : shape.min[depth] - 1000;
    const half = span / 200;
    const lens = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 1000);
    lens.matrixAutoUpdate = false;
    const { right, up, toward, mirrored } = camera(v);
    lens.matrix.makeBasis(
      new THREE.Vector3(...right),
      new THREE.Vector3(...up),
      new THREE.Vector3(...toward),
    );
    lens.matrix.setPosition(new THREE.Vector3(...toThree(at)));
    lens.updateMatrixWorld(true);
    const shoot = (clear: number) => {
      r.setClearColor(clear, 1);
      r.render(scene, lens);
      const c = new OffscreenCanvas(SIZE, SIZE);
      const g = context(c);
      if (mirrored) g.setTransform(-1, 0, 0, 1, SIZE, 0);
      g.drawImage(r.domElement, 0, 0, SIZE, SIZE);
      return c;
    };
    scene.overrideMaterial = null;
    const shaded = await dataUrl(shoot(BACKGROUND));
    scene.overrideMaterial = white;
    const outline = context(shoot(0x000000)).getImageData(0, 0, SIZE, SIZE).data;
    shots[v.name] = { shaded, mask: covered(outline, "red") };
  }
  /* named as the viewer draws it: a box with an outline is that outline's prism */
  const p = shape.kind === "box" ? PROFILES[mesh] : undefined;
  const kind = p ? `outline ${[p.view, p.squeeze?.view].filter(Boolean).join("+")}` : shape.kind;
  return { kind, shots };
}

/* a canvas's 2D context; Chromium always has one */
function context(c: OffscreenCanvas) {
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2D canvas");
  return g;
}

async function image(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

async function pixels(src: string) {
  const img = await image(src);
  const c = new OffscreenCanvas(SIZE, SIZE);
  const g = context(c);
  g.drawImage(img, 0, 0, SIZE, SIZE);
  return g.getImageData(0, 0, SIZE, SIZE).data;
}

/* 1 where a pixel is covered: the viewer's white on black, or the render's opaque on clear */
function covered(data: Uint8ClampedArray, by: "red" | "alpha") {
  const out = new Uint8Array(SIZE * SIZE);
  const channel = by === "red" ? 0 : 3;
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + channel] > 127 ? 1 : 0;
  return out;
}

async function piece(mesh: string, refs: PieceRefs | null, withSheet: boolean) {
  const { kind, shots } = await draw(mesh);
  const masks: Partial<Record<string, Uint8Array>> = {};
  if (refs)
    for (const v of VIEWS) {
      const ref = refs[v.name];
      if (ref) masks[v.name] = covered(await pixels(ref.mask), "alpha");
    }
  const scored = VIEWS.map((v) => [v.name, masks[v.name], shots[v.name].mask] as const);
  const scores = scored.every(([, m]) => m)
    ? Object.fromEntries(scored.map(([name, m, mine]) => [name, overlap(m, mine)]))
    : null;
  const result: PieceResult = { kind, scores };
  if (withSheet) result.sheet = await sheet(mesh, kind, shots, refs, masks, scores);
  return result;
}

/* one column per view; rows: the mesh render, the viewer, then the two outlines */
async function sheet(
  mesh: string,
  kind: string,
  shots: Record<string, { shaded: string; mask: Uint8Array }>,
  refs: PieceRefs | null,
  masks: Partial<Record<string, Uint8Array>>,
  scores: Record<string, number> | null,
) {
  const rows = refs ? ["game", "viewer", "outlines"] : ["viewer"];
  const label = 22;
  const left = 70;
  const c = new OffscreenCanvas(left + CELL * VIEWS.length, label * 2 + CELL * rows.length);
  const g = context(c);
  g.fillStyle = "#0b0c10";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#e8ecf2";
  g.font = "14px sans-serif";
  g.fillText(`${mesh} (stand-in: ${kind})`, 6, 16);
  for (const [i, v] of VIEWS.entries()) {
    const x = left + i * CELL;
    const score = scores ? ` ${scores[v.name].toFixed(2)}` : "";
    g.fillText(v.name + score, x + 6, label + 16);
    for (const [j, row] of rows.entries()) {
      const y = label * 2 + j * CELL;
      if (i === 0) g.fillText(row, 6, y + CELL / 2);
      const ref = refs?.[v.name];
      const a = masks[v.name];
      if (row === "viewer") g.drawImage(await image(shots[v.name].shaded), x, y, CELL, CELL);
      else if (row === "game" && ref) g.drawImage(await image(ref.ortho), x, y, CELL, CELL);
      else if (row === "outlines" && a) {
        const o = outlines(a, shots[v.name].mask);
        g.drawImage(o, x, y, CELL, CELL);
      }
    }
  }
  return dataUrl(c);
}

/* two outlines over each other: red only the game's, cyan only the viewer's, white both */
function outlines(game: Uint8Array, viewer: Uint8Array) {
  const out = new ImageData(SIZE, SIZE);
  for (let k = 0; k < game.length; k++) {
    const colour = game[k] ? (viewer[k] ? WHITE : RED) : viewer[k] ? CYAN : DARK;
    out.data.set(colour, k * 4);
  }
  const c = new OffscreenCanvas(SIZE, SIZE);
  context(c).putImageData(out, 0, 0);
  return c;
}
const [WHITE, RED, CYAN, DARK] = [
  [230, 230, 230, 255],
  [230, 60, 60, 255],
  [60, 210, 230, 255],
  [20, 22, 28, 255],
];

async function dataUrl(c: OffscreenCanvas) {
  const blob = await c.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return "data:image/png;base64," + btoa(s);
}

Object.assign(globalThis, { piece, meshes: () => Object.keys(MESHES) });
