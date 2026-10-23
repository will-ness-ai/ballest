// A Prefab's share image drawn without a GPU (components/share/prefab.ts and raster.ts): the
// picture is the Prefab as its viewer shows it, clear where no piece is.
import { inflateSync } from "node:zlib";

import { describe, expect, test } from "vitest";

import { prefabPicture } from "../components/share/prefab";
import { png } from "../components/share/raster";
import type { PrefabFile } from "../lib/prefab";
import type { PrefabAngle } from "../lib/prefabs";

const CUBE = "/Game/Blueprints/Editor/BP_Prim_Cube.BP_Prim_Cube_C";
const BOX = "/Game/Art/GreyBoxing/_GENERATED/PC/Box_C559BEB3.Box_C559BEB3";
const RED = "/Game/M/MI_Env_Red.MI_Env_Red";

/* scale-1 red cubes at these locations (cm), each scaled as given */
function cubes(...items: Array<{ at: Array<number>; scale?: Array<number> }>): PrefabFile {
  return {
    format: "BallestPrefab",
    version: 1,
    group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
    items: items.map(({ at, scale = [1, 1, 1] }) => ({
      class: CUBE,
      transform: { location: at, rotation: [0, 0, 0], scale },
      meshes: [{ mesh: BOX, materials: [RED] }],
    })) as PrefabFile["items"],
  };
}

/* a PNG this module wrote, back to its size and RGBA bytes (one IDAT, no filtering) */
function decode(buf: Buffer) {
  expect(buf.subarray(1, 4).toString()).toBe("PNG");
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const idat = buf.indexOf("IDAT");
  const rows = inflateSync(buf.subarray(idat + 4, idat + 4 + buf.readUInt32BE(idat - 4)));
  const px = (x: number, y: number) => {
    const o = y * (w * 4 + 1) + 1 + x * 4;
    return [...rows.subarray(o, o + 4)];
  };
  return { w, h, px };
}

describe("a Prefab's share picture", () => {
  test("draws the Prefab in the middle and leaves the rest clear", async () => {
    const { w, h, px } = decode(await prefabPicture(cubes({ at: [0, 0, 0] }), null, 120, 63));
    expect([w, h]).toEqual([120, 63]);
    const [r, g, b, a] = px(60, 31);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(2 * Math.max(g, b));
    expect(px(0, 0)[3]).toBe(0);
    expect(px(119, 62)[3]).toBe(0);
  });

  test("the uploader's angle frames it", async () => {
    /* straight down from far above: a small square in the middle, the edges of the default
       view's cube clear */
    const above = decode(
      await prefabPicture(
        cubes({ at: [0, 0, 0] }),
        { from: [0, 1, 0.001], zoom: 3, pan: [0, 0, 0] },
        120,
        63,
      ),
    );
    expect(above.px(60, 31)[3]).toBe(255);
    expect(above.px(42, 31)[3]).toBe(0);
    const plain = decode(await prefabPicture(cubes({ at: [0, 0, 0] }), null, 120, 63));
    expect(plain.px(42, 31)[3]).toBe(255);
  });

  test("a mirrored piece is lit as the same piece unmirrored, not from inside", async () => {
    const plain = decode(await prefabPicture(cubes({ at: [0, 0, 0] }), null, 120, 63));
    const mirrored = decode(
      await prefabPicture(cubes({ at: [0, 0, 0], scale: [-1, 1, 1] }), null, 120, 63),
    );
    /* on its top, which the sky lights and the ground would leave dark */
    for (const [x, y] of [
      [60, 14],
      [60, 18],
      [52, 18],
    ])
      mirrored.px(x, y).forEach((c, i) => expect(Math.abs(c - plain.px(x, y)[i])).toBeLessThan(6));
  });

  test("a camera inside the Prefab still draws what is in front of it", async () => {
    const inside: PrefabAngle = { from: [0, 0, 1], zoom: 0.05, pan: [0, 0, 0] };
    const { px } = decode(await prefabPicture(cubes({ at: [0, 0, 0] }), inside, 40, 21));
    for (const [x, y] of [
      [0, 0],
      [20, 10],
      [39, 20],
    ])
      expect(px(x, y)[3]).toBe(255);
  });

  test("the PNG keeps each pixel as given", () => {
    const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 9, 9, 9]);
    const { w, h, px } = decode(png(rgba, 2, 2));
    expect([w, h]).toEqual([2, 2]);
    expect([px(0, 0), px(1, 0), px(0, 1), px(1, 1)]).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 128],
      [0, 0, 255, 0],
      [9, 9, 9, 9],
    ]);
  });
});
