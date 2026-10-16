// GET, PUT and DELETE /api/prefabs/<slug>/favorite: the reader's heart on a Prefab
// (db/prefab-api.ts favoritePrefab). Never cached.
import { connection } from "next/server";

import { prefabDeps } from "../../../../../db/data";
import { favoritePrefab } from "../../../../../db/prefab-api";
import { isPrefabSlug } from "../../../../../lib/routes";

interface Ctx {
  params: Promise<{ slug: string }>;
}

async function handle(request: Request, { params }: Ctx) {
  await connection();
  const { slug } = await params;
  if (!isPrefabSlug(slug)) return Response.json({ error: "no such prefab" }, { status: 404 });
  return favoritePrefab(request, prefabDeps(), slug);
}

export { handle as GET, handle as PUT, handle as DELETE };
