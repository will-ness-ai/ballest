// A three.js scene drawn without a GPU, for a picture a server makes: the share image of a
// Prefab (docs/site.md, "Share images"). A function has no WebGL, so this walks the scene's
// instanced meshes, all a Prefab's scene draws (components/prefabs/scene.ts; a Map's water
// sheet and the ground grid are plain meshes, left out), and fills triangles into
// a depth buffer itself, lit as MeshStandardMaterial lights them (diffuse only: the pieces
// are rough enough that the highlights hardly show), drawn SUPERSAMPLE times larger and
// shrunk so the edges are smooth, and returned as a PNG whose empty pixels are clear.
import { crc32, deflateSync } from "node:zlib";

import type { Camera, Color, InstancedMesh, MeshStandardMaterial, Object3D } from "three";

type Three = typeof import("three");

const SUPERSAMPLE = 3;

interface Lights {
  sky: Array<number>;
  ground: Array<number>;
  /* each directional light's direction toward it, unit length, and its colour times intensity */
  suns: Array<{ dir: Array<number>; colour: Array<number> }>;
}

const rgb = (c: Color, k = 1) => [c.r * k, c.g * k, c.b * k];

function lightsOf(THREE: Three, scene: Object3D): Lights {
  const out: Lights = { sky: [0, 0, 0], ground: [0, 0, 0], suns: [] };
  scene.traverse((o) => {
    if (o instanceof THREE.HemisphereLight) {
      out.sky = rgb(o.color, o.intensity);
      out.ground = rgb(o.groundColor, o.intensity);
    } else if (o instanceof THREE.DirectionalLight) {
      const dir = o.position.clone().sub(o.target.position).normalize();
      out.suns.push({ dir: dir.toArray(), colour: rgb(o.color, o.intensity) });
    }
  });
  return out;
}

/* a lit vertex's linear colour, as three's physical lights give it: each light's irradiance
   times the Lambert BRDF, albedo over pi, plus what the piece itself gives off */
function shade(
  l: Lights,
  albedo: Array<number>,
  glow: Array<number>,
  nx: number,
  ny: number,
  nz: number,
  out: Float64Array,
  at: number,
) {
  const t = 0.5 * ny + 0.5;
  let r = l.ground[0] + (l.sky[0] - l.ground[0]) * t;
  let g = l.ground[1] + (l.sky[1] - l.ground[1]) * t;
  let b = l.ground[2] + (l.sky[2] - l.ground[2]) * t;
  for (const s of l.suns) {
    const d = Math.max(0, nx * s.dir[0] + ny * s.dir[1] + nz * s.dir[2]);
    r += s.colour[0] * d;
    g += s.colour[1] * d;
    b += s.colour[2] * d;
  }
  out[at] = (r * albedo[0]) / Math.PI + glow[0];
  out[at + 1] = (g * albedo[1]) / Math.PI + glow[1];
  out[at + 2] = (b * albedo[2]) / Math.PI + glow[2];
}

/* one vertex of a triangle on its way to the screen: clip space and its lit colour */
type Vert = [x: number, y: number, z: number, w: number, r: number, g: number, b: number];

function lerpVert(a: Vert, b: Vert, t: number): Vert {
  return a.map((v, i) => v + (b[i] - v) * t) as Vert;
}

/* a triangle cut to what lies in front of the near plane (z > -w): none, one or two */
function clipNear(tri: Array<Vert>): Array<Array<Vert>> {
  const d = tri.map((v) => v[2] + v[3]);
  if (d.every((x) => x >= 0)) return [tri];
  if (d.every((x) => x < 0)) return [];
  const poly: Array<Vert> = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if (d[i] >= 0) poly.push(tri[i]);
    if (d[i] >= 0 !== d[j] >= 0) poly.push(lerpVert(tri[i], tri[j], d[i] / (d[i] - d[j])));
  }
  return poly.length === 3 ? [poly] : [poly.slice(0, 3), [poly[0], poly[2], poly[3]]];
}

/**
 * The scene as `camera` sees it at `w` × `h`, an RGBA PNG: transparent where no piece is.
 */
export function rasterize(THREE: Three, scene: Object3D, camera: Camera, w: number, h: number) {
  const W = w * SUPERSAMPLE;
  const H = h * SUPERSAMPLE;
  const depth = new Float32Array(W * H).fill(Infinity);
  const colour = new Float32Array(W * H * 3);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const lights = lightsOf(THREE, scene);
  const meshes: Array<InstancedMesh> = [];
  scene.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) meshes.push(o as InstancedMesh);
  });

  const fill = (a: Vert, b: Vert, c: Vert) => {
    /* to pixels; y runs down the picture */
    const x0 = (a[0] / a[3] + 1) * 0.5 * W,
      y0 = (1 - a[1] / a[3]) * 0.5 * H;
    const x1 = (b[0] / b[3] + 1) * 0.5 * W,
      y1 = (1 - b[1] / b[3]) * 0.5 * H;
    const x2 = (c[0] / c[3] + 1) * 0.5 * W,
      y2 = (1 - c[1] / c[3]) * 0.5 * H;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0 || !isFinite(area)) return;
    const z0 = a[2] / a[3],
      z1 = b[2] / b[3],
      z2 = c[2] / c[3];
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const l0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const l1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const z = l0 * z0 + l1 * z1 + l2 * z2;
        const i = y * W + x;
        if (z >= depth[i] || z > 1) continue;
        depth[i] = z;
        /* the colour across the triangle in 3D, not on the screen, as a GPU blends it */
        const p0 = l0 / a[3],
          p1 = l1 / b[3],
          p2 = l2 / c[3];
        const sum = p0 + p1 + p2;
        colour[3 * i] = (p0 * a[4] + p1 * b[4] + p2 * c[4]) / sum;
        colour[3 * i + 1] = (p0 * a[5] + p1 * b[5] + p2 * c[5]) / sum;
        colour[3 * i + 2] = (p0 * a[6] + p1 * b[6] + p2 * c[6]) / sum;
      }
    }
  };

  const world = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const toClip = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const tri: Array<Vert> = [];
  for (const mesh of meshes) {
    const m = mesh.material as MeshStandardMaterial;
    const albedo = rgb(m.color, 1 - m.metalness);
    const glow = rgb(m.emissive, m.emissiveIntensity);
    const pos = mesh.geometry.getAttribute("position").array;
    const nor = mesh.geometry.getAttribute("normal").array;
    const verts = pos.length / 3;
    const index = mesh.geometry.getIndex()?.array ?? Array.from({ length: verts }, (_, i) => i);
    const clip = new Float64Array(verts * 4);
    const lit = new Float64Array(verts * 3);
    const lit2 = new Float64Array(verts * 3);
    const wpos = new Float64Array(verts * 3);
    for (let k = 0; k < mesh.count; k++) {
      mesh.getMatrixAt(k, instance);
      world.multiplyMatrices(mesh.matrixWorld, instance);
      toClip.multiplyMatrices(viewProj, world);
      normalMatrix.getNormalMatrix(world);
      /* a mirrored piece turns its triangles' winding over */
      const mirrored = world.determinant() < 0;
      const a = world.elements;
      const c = toClip.elements;
      const q = normalMatrix.elements;
      for (let v = 0; v < verts; v++) {
        const x = pos[3 * v],
          y = pos[3 * v + 1],
          z = pos[3 * v + 2];
        wpos[3 * v] = a[0] * x + a[4] * y + a[8] * z + a[12];
        wpos[3 * v + 1] = a[1] * x + a[5] * y + a[9] * z + a[13];
        wpos[3 * v + 2] = a[2] * x + a[6] * y + a[10] * z + a[14];
        clip[4 * v] = c[0] * x + c[4] * y + c[8] * z + c[12];
        clip[4 * v + 1] = c[1] * x + c[5] * y + c[9] * z + c[13];
        clip[4 * v + 2] = c[2] * x + c[6] * y + c[10] * z + c[14];
        clip[4 * v + 3] = c[3] * x + c[7] * y + c[11] * z + c[15];
        const u = nor[3 * v],
          e = nor[3 * v + 1],
          f = nor[3 * v + 2];
        let nx = q[0] * u + q[3] * e + q[6] * f;
        let ny = q[1] * u + q[4] * e + q[7] * f;
        let nz = q[2] * u + q[5] * e + q[8] * f;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        /* both sides are drawn (DoubleSide), each lit from its own side */
        shade(lights, albedo, glow, nx, ny, nz, lit, 3 * v);
        shade(lights, albedo, glow, -nx, -ny, -nz, lit2, 3 * v);
      }
      for (let t = 0; t < index.length; t += 3) {
        const i0 = 3 * index[t],
          i1 = 3 * index[t + 1],
          i2 = 3 * index[t + 2];
        /* the side facing the camera: the triangle's own normal against the way to the eye */
        const ux = wpos[i1] - wpos[i0],
          uy = wpos[i1 + 1] - wpos[i0 + 1],
          uz = wpos[i1 + 2] - wpos[i0 + 2];
        const vx = wpos[i2] - wpos[i0],
          vy = wpos[i2 + 1] - wpos[i0 + 1],
          vz = wpos[i2 + 2] - wpos[i0 + 2];
        const fx = uy * vz - uz * vy,
          fy = uz * vx - ux * vz,
          fz = ux * vy - uy * vx;
        const toEye =
          fx * (eye.x - wpos[i0]) + fy * (eye.y - wpos[i0 + 1]) + fz * (eye.z - wpos[i0 + 2]);
        const src = toEye >= 0 !== mirrored ? lit : lit2;
        for (let j = 0; j < 3; j++) {
          const i = index[t + j];
          tri[j] = [
            clip[4 * i],
            clip[4 * i + 1],
            clip[4 * i + 2],
            clip[4 * i + 3],
            src[3 * i],
            src[3 * i + 1],
            src[3 * i + 2],
          ];
        }
        for (const [p0, p1, p2] of clipNear(tri)) fill(p0, p1, p2);
      }
    }
  }
  return png(resolve(depth, colour, w, h), w, h);
}

/* linear light to the sRGB byte the screen shows */
function srgb(x: number) {
  const c = Math.min(1, Math.max(0, x));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/* each picture pixel from its SUPERSAMPLE² samples: the covered ones' colour, and how many
   were covered as its alpha */
function resolve(depth: Float32Array, colour: Float32Array, w: number, h: number) {
  const W = w * SUPERSAMPLE;
  const out = Buffer.alloc(w * h * 4);
  const all = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0,
        hit = 0;
      for (let dy = 0; dy < SUPERSAMPLE; dy++)
        for (let dx = 0; dx < SUPERSAMPLE; dx++) {
          const i = (y * SUPERSAMPLE + dy) * W + x * SUPERSAMPLE + dx;
          if (depth[i] === Infinity) continue;
          hit++;
          r += colour[3 * i];
          g += colour[3 * i + 1];
          b += colour[3 * i + 2];
        }
      const o = 4 * (y * w + x);
      if (!hit) continue;
      out[o] = srgb(r / hit);
      out[o + 1] = srgb(g / hit);
      out[o + 2] = srgb(b / hit);
      out[o + 3] = Math.round((255 * hit) / all);
    }
  return out;
}

/* RGBA bytes as a PNG: one IDAT, no filtering */
export function png(rgba: Buffer, w: number, h: number) {
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
