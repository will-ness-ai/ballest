// A Workshop Map's file (the .ballmap the editor saves, docs/data.md "Map files") read into
// the Prefab shape the viewer already draws (lib/prefab.ts). A .ballmap item carries a
// quaternion where a Prefab carries Unreal's FRotator, and wraps each path in its type and
// quote marks (`/Script/Engine.BlueprintGeneratedClass'/Game/X.X_C'`) where a Prefab writes
// the path alone.
import type { PrefabFile, PrefabItem } from "./prefab";

type Vec3 = [number, number, number];
interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface BallmapItem {
  actorToSpawn: string;
  itemTransform: {
    rotation: Quat;
    translation: { x: number; y: number; z: number };
    scale3D: { x: number; y: number; z: number };
  };
  meshComponents?: Array<{
    meshAssetPath?: string;
    materials?: Array<{ material: string }>;
  }> | null;
}

/* only what the viewer reads; the file holds much more */
export interface BallmapFile {
  worldSettings?: unknown;
  items: Array<BallmapItem>;
}

/** the height of the water every Workshop Map is played in, Unreal z in cm: the level's own
    water (Map_TrackUGCPlayback's Water_Plane, from BP_ArenaPieces, read from the game's files
    2026-10-19), a flat sheet about 2 km across, the same in the editor. A .ballmap doesn't hold
    it. The ball dies a little lower, at the kill zone's z of 100. */
export const MAP_WATER = 126.71;

const DEG = 180 / Math.PI;
/* how close to straight up or down FQuat::Rotator treats as straight */
const SINGULAR = 0.4999995;

/* Unreal's FQuat::Rotator, [pitch, yaw, roll] in degrees, with its handling of a piece
   pointing straight up or down (where pitch alone can't say which way it faces) */
export function rotatorOf({ x, y, z, w }: Quat): Vec3 {
  const test = z * x - w * y;
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * DEG;
  if (test < -SINGULAR) return [-90, yaw, -yaw - 2 * Math.atan2(x, w) * DEG];
  if (test > SINGULAR) return [90, yaw, yaw - 2 * Math.atan2(x, w) * DEG];
  return [
    Math.asin(2 * test) * DEG,
    yaw,
    Math.atan2(-2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG,
  ];
}

/* the path inside `Type'path'`, or the string as it is */
const pathOf = (s: string) => /'([^']*)'/.exec(s)?.[1] ?? s;

export function prefabOfBallmap(map: BallmapFile): PrefabFile {
  const items = map.items.map((it): PrefabItem => {
    const { rotation, translation: t, scale3D: s } = it.itemTransform;
    return {
      class: pathOf(it.actorToSpawn),
      transform: {
        location: [t.x, t.y, t.z],
        rotation: rotatorOf(rotation),
        scale: [s.x, s.y, s.z],
      },
      meshes: (it.meshComponents ?? []).flatMap((m) =>
        m.meshAssetPath
          ? [
              {
                mesh: pathOf(m.meshAssetPath),
                materials: (m.materials ?? []).map((x) => pathOf(x.material)),
              },
            ]
          : [],
      ),
    };
  });
  return {
    format: "BallestPrefab",
    version: 1,
    group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
    items,
  };
}
