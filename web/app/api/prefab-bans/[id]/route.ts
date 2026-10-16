// PUT /api/prefab-bans/<steam_id>: the admin bans a player from uploading, hiding their
// Prefabs; DELETE lifts it (db/prefab-api.ts banUploader). Never cached.
import { connection } from "next/server";

import { prefabDeps } from "../../../../db/data";
import { banUploader } from "../../../../db/prefab-api";
import { isSteamId } from "../../../../lib/rules";

interface Ctx {
  params: Promise<{ id: string }>;
}

async function handle(request: Request, { params }: Ctx) {
  await connection();
  const { id } = await params;
  if (!isSteamId(id)) return Response.json({ error: "not a Steam ID" }, { status: 404 });
  return banUploader(request, prefabDeps(), id);
}

export { handle as PUT, handle as DELETE };
