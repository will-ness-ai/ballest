// PATCH /api/prefabs/<slug>: its uploader edits a Prefab's name, description and tags.
// DELETE: its uploader deletes it (db/prefab-api.ts editPrefab). Never cached.
import { editPrefab } from "../../../../db/prefab-api";
import { prefabRoute } from "../../../../db/prefab-route";

const handle = prefabRoute(editPrefab);

export { handle as PATCH, handle as DELETE };
