// PROTOTYPE (grill-design, claude/prototype-maps3d): a Workshop Map's .ballmap file read into
// the Prefab shape the viewer already draws. A .ballmap item carries a quaternion where a
// Prefab carries Unreal's FRotator, so each is turned into one (FQuat::Rotator's formula).
import type { PrefabFile, PrefabItem } from "./prefab";

type Vec3 = [number, number, number];

interface BallmapItem {
  actorToSpawn: string;
  itemTransform: {
    rotation: { x: number; y: number; z: number; w: number };
    translation: { x: number; y: number; z: number };
    scale3D: { x: number; y: number; z: number };
  };
  meshComponents?: Array<{
    meshAssetPath?: string;
    materials?: Array<{ material: string }>;
  }> | null;
}

export interface BallmapFile {
  worldSettings?: {
    levelData?: {
      levelDisplayName?: string;
      creatorName?: string;
      medalTimesByIndex?: Array<number>;
    };
    directionalLight?: { timeOfDay?: number };
  };
  items: Array<BallmapItem>;
}

const DEG = 180 / Math.PI;

/* Unreal's FQuat::Rotator: [pitch, yaw, roll] in degrees */
export function rotatorOf({ x, y, z, w }: { x: number; y: number; z: number; w: number }): Vec3 {
  const test = z * x - w * y;
  const yawY = 2 * (w * z + x * y);
  const yawX = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(yawY, yawX) * DEG;
  if (test < -0.4999995) return [-90, yaw, -yaw - 2 * Math.atan2(x, w) * DEG];
  if (test > 0.4999995) return [90, yaw, yaw - 2 * Math.atan2(x, w) * DEG];
  return [
    Math.asin(2 * test) * DEG,
    yaw,
    Math.atan2(-2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG,
  ];
}

const clean = (s: string) => s.replace(/'/g, "");

export function prefabOfBallmap(map: BallmapFile): PrefabFile {
  const items: Array<PrefabItem> = map.items.map((it) => {
    const { rotation, translation: t, scale3D: s } = it.itemTransform;
    return {
      class: clean(it.actorToSpawn),
      transform: {
        location: [t.x, t.y, t.z],
        rotation: rotatorOf(rotation),
        scale: [s.x, s.y, s.z],
      },
      meshes: (it.meshComponents ?? [])
        .filter((m) => m.meshAssetPath)
        .map((m) => ({
          mesh: clean(m.meshAssetPath ?? ""),
          materials: (m.materials ?? []).map((x) => clean(x.material)),
        })),
    };
  });
  return {
    format: "BallestPrefab",
    version: 1,
    group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
    items,
  };
}
