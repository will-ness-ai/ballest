// POST /api/prefabs/<slug>/takedown: the admin takes a Prefab down (db/prefab-api.ts
// takeDownPrefab). Never cached.
import { takeDownPrefab } from "../../../../../db/prefab-api";
import { prefabRoute } from "../../../../../db/prefab-route";

export const POST = prefabRoute(takeDownPrefab);
