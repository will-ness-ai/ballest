// GET, PUT and DELETE /api/prefab-limits/<steam_id>: the admin reads, sets or resets a
// player's daily upload limit (db/prefab-api.ts uploadLimit). Never cached.
import { connection } from "next/server";

import { prefabDeps } from "../../../../db/data";
import { uploadLimit } from "../../../../db/prefab-api";
import { isSteamId } from "../../../../lib/rules";

interface Ctx {
  params: Promise<{ id: string }>;
}

async function handle(request: Request, { params }: Ctx) {
  await connection();
  const { id } = await params;
  if (!isSteamId(id)) return Response.json({ error: "not a Steam ID" }, { status: 404 });
  return uploadLimit(request, prefabDeps(), id);
}

export { handle as GET, handle as PUT, handle as DELETE };
