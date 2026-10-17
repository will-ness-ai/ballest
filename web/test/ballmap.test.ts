// A Workshop Map's .ballmap read into the Prefab shape the viewer draws (lib/ballmap.ts):
// each item's quaternion as Unreal's FRotator, and its paths as a Prefab file writes them.
import { describe, expect, test } from "vitest";

import { prefabOfBallmap, rotatorOf, type BallmapFile } from "../lib/ballmap";
import { shapesOf } from "../lib/prefab";

const RAD = Math.PI / 180;
/* a turn of `deg` about one axis, as a unit quaternion */
const about = (axis: "x" | "y" | "z", deg: number) => {
  const s = Math.sin((deg * RAD) / 2);
  return { x: 0, y: 0, z: 0, [axis]: s, w: Math.cos((deg * RAD) / 2) } as {
    x: number;
    y: number;
    z: number;
    w: number;
  };
};
const close = (got: Array<number>, want: Array<number>) =>
  got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 6));

describe("a quaternion as [pitch, yaw, roll]", () => {
  test("no turn is no rotation", () => {
    close(rotatorOf({ x: 0, y: 0, z: 0, w: 1 }), [0, 0, 0]);
  });

  test("a turn about Unreal's up axis (z) is yaw", () => {
    close(rotatorOf(about("z", 90)), [0, 90, 0]);
    close(rotatorOf(about("z", -30)), [0, -30, 0]);
  });

  test("a turn about Unreal's right axis (y) is pitch, nose up for a negative turn", () => {
    // FRotator's pitch is a right-handed turn about -y: (0, -sin 15°, 0, cos 15°) is pitch 30
    close(rotatorOf(about("y", -30)), [30, 0, 0]);
    close(rotatorOf(about("y", 45)), [-45, 0, 0]);
  });

  test("a turn about the forward axis (x) is roll", () => {
    close(rotatorOf(about("x", -60)), [0, 0, 60]);
  });

  test("straight up is pitch 90 with the rest folded into yaw and roll", () => {
    // pitch 90 then yaw 0: FQuat::Rotator's singular branch, roll from 2·atan2(x, w)
    close(rotatorOf(about("y", -90)), [90, 0, 0]);
    // a little past the threshold still reads as straight up
    const up = about("y", -89.99999);
    expect(rotatorOf(up)[0]).toBe(90);
  });

  test("straight down is pitch -90", () => {
    close(rotatorOf(about("y", 90)), [-90, 0, 0]);
    expect(rotatorOf(about("y", 89.99999))[0]).toBe(-90);
  });
});

/* two items as the editor saves them (shapes copied from Giga Tree, 3820471145, read
   2026-10-17): every path wrapped in its type and quote marks */
const TWO: BallmapFile = {
  worldSettings: { levelData: { userLevelName: "Two pieces" } },
  items: [
    {
      actorToSpawn:
        "/Script/Engine.BlueprintGeneratedClass'/Game/MapItems/PlayerStart/MP_PlayerStart.MP_PlayerStart_C'",
      itemTransform: {
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        translation: { x: 100, y: -200, z: 50 },
        scale3D: { x: 0.5, y: 0.5, z: 0.5 },
      },
      meshComponents: [
        {
          meshAssetPath: "/Game/Maps/_GENERATED/PC/SM_Start_Fixed.SM_Start_Fixed",
          materials: [
            {
              material:
                "/Script/Engine.MaterialInstanceConstant'/Game/Art/Stadium/Arena/MI_GoalYellow.MI_GoalYellow'",
            },
          ],
        },
      ],
    },
    {
      actorToSpawn:
        "/Script/Engine.BlueprintGeneratedClass'/Game/LevelEditor/PackageAssets/MultiplayerLevelEditor/ExampleObjects/BallestPieces/BP_Prim_Cube.BP_Prim_Cube_C'",
      itemTransform: {
        rotation: about("z", 90),
        translation: { x: 0, y: 0, z: 0 },
        scale3D: { x: 2, y: 1, z: 0.25 },
      },
      meshComponents: [
        {
          meshAssetPath: "/Game/Art/GreyBoxing/_GENERATED/PC/Box_C559BEB3.Box_C559BEB3",
          materials: [
            {
              material:
                "/Script/Engine.MaterialInstanceConstant'/Game/Art/Materials/Environment/MI_Env_Lime.MI_Env_Lime'",
            },
          ],
        },
        // a component with no mesh draws nothing
        { materials: [] },
      ],
    },
  ],
};

describe("a .ballmap as a Prefab file", () => {
  test("a two-item file keeps each item's place, turn, size and paths", () => {
    const file = prefabOfBallmap(TWO);
    expect(file.format).toBe("BallestPrefab");
    expect(file.group).toEqual({ rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(file.items).toHaveLength(2);
    const [start, cube] = file.items;
    close(start.transform.rotation, [0, 0, 0]);
    expect({ ...start, transform: { ...start.transform, rotation: null } }).toEqual({
      class: "/Game/MapItems/PlayerStart/MP_PlayerStart.MP_PlayerStart_C",
      transform: { location: [100, -200, 50], rotation: null, scale: [0.5, 0.5, 0.5] },
      meshes: [
        {
          mesh: "/Game/Maps/_GENERATED/PC/SM_Start_Fixed.SM_Start_Fixed",
          materials: ["/Game/Art/Stadium/Arena/MI_GoalYellow.MI_GoalYellow"],
        },
      ],
    });
    expect(cube.class).toBe(
      "/Game/LevelEditor/PackageAssets/MultiplayerLevelEditor/ExampleObjects/BallestPieces/BP_Prim_Cube.BP_Prim_Cube_C",
    );
    close(cube.transform.rotation, [0, 90, 0]);
    expect(cube.meshes).toEqual([
      {
        mesh: "/Game/Art/GreyBoxing/_GENERATED/PC/Box_C559BEB3.Box_C559BEB3",
        materials: ["/Game/Art/Materials/Environment/MI_Env_Lime.MI_Env_Lime"],
      },
    ]);
  });

  test("the viewer draws it", () => {
    expect(shapesOf(prefabOfBallmap(TWO)).length).toBeGreaterThanOrEqual(2);
  });

  test("an item with no mesh components is kept with none", () => {
    const file = prefabOfBallmap({
      items: [{ ...TWO.items[0], meshComponents: null }],
    });
    expect(file.items[0].meshes).toEqual([]);
  });
});
