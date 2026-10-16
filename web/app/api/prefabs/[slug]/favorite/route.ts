// GET, PUT and DELETE /api/prefabs/<slug>/favorite: the reader's heart on a Prefab
// (db/prefab-api.ts favoritePrefab). Never cached.
import { favoritePrefab } from "../../../../../db/prefab-api";
import { prefabRoute } from "../../../../../db/prefab-route";

const handle = prefabRoute(favoritePrefab);

export { handle as GET, handle as PUT, handle as DELETE };
