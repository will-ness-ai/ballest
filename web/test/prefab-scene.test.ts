// The Prefab viewer's three.js scene (components/prefabs/scene.ts), built without a renderer.
import { describe, expect, test } from "vitest";

import { buildScene, loadThree } from "../components/prefabs/scene";
import type { PrefabFile } from "../lib/prefab";

const CUBE = "/Game/Blueprints/Editor/BP_Prim_Cube.BP_Prim_Cube_C";
const BOX = "/Game/Art/GreyBoxing/_GENERATED/PC/Box_C559BEB3.Box_C559BEB3";
const LIME = "/Game/M/MI_Env_Lime.MI_Env_Lime";
const RED = "/Game/M/MI_Env_Red.MI_Env_Red";

/* a file of unturned scale-1 cubes, each [location cm, material]; such a cube is 10 across */
function cubes(...items: Array<[Array<number>, string]>): PrefabFile {
  return {
    format: "BallestPrefab",
    version: 1,
    group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
    items: items.map(([location, material]) => ({
      class: CUBE,
      transform: { location, rotation: [0, 0, 0], scale: [1, 1, 1] },
      meshes: [{ mesh: BOX, materials: [material] }],
    })) as PrefabFile["items"],
  };
}

const three = await loadThree();

/* the scene's draws, as how many pieces each one draws, fewest first */
const drawsOf = (scene: import("three").Scene) => {
  const out: Array<number> = [];
  scene.traverse((o) => {
    if (o instanceof three.THREE.InstancedMesh) out.push(o.count);
    else if (o instanceof three.THREE.Mesh) out.push(1);
  });
  return out.sort((a, b) => a - b);
};

describe("a Prefab's scene", () => {
  test("pieces of one geometry and colour draw as one instanced mesh", () => {
    const row = Array.from({ length: 2000 }, (_, i): [Array<number>, string] => [
      [i * 1000, 0, 0],
      LIME,
    ]);
    const { scene } = buildScene(three, cubes(...row, [[0, 1000, 0], RED]), false);
    expect(drawsOf(scene)).toEqual([1, 2000]);
  });

  test("the framing still fits every piece", () => {
    /* two cubes 90 apart: 100 long, 10 high and deep */
    const { centre, radius } = buildScene(
      three,
      cubes([[0, 0, 0], LIME], [[9000, 0, 0], LIME]),
      false,
    );
    expect(centre.x).toBeCloseTo(45);
    expect(radius).toBeCloseTo(Math.sqrt(100 ** 2 + 10 ** 2 + 10 ** 2) / 2);
  });

  test("the ground grid is no more than 40 squares across, however big the file", () => {
    const { scene } = buildScene(three, cubes([[0, 0, 0], LIME], [[500000, 0, 0], LIME]));
    const grid = scene.children.find((o) => o instanceof three.THREE.GridHelper);
    if (!(grid instanceof three.THREE.GridHelper)) throw new Error("no grid");
    /* each line is two points, and the lines run both ways; 41 of them bound 40 squares */
    const lines = grid.geometry.getAttribute("position").count / 2 / 2;
    expect(lines).toBeLessThanOrEqual(41);
  });
});
