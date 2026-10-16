// PATCH /api/prefabs/<slug>: its uploader edits a Prefab's name, description and tags.
// DELETE: its uploader deletes it (db/prefab-api.ts editPrefab). Never cached.
import { connection } from "next/server";

import { prefabDeps } from "../../../../db/data";
import { editPrefab } from "../../../../db/prefab-api";
import { isPrefabSlug } from "../../../../lib/routes";

interface Ctx {
  params: Promise<{ slug: string }>;
}

async function handle(request: Request, { params }: Ctx) {
  await connection();
  const { slug } = await params;
  if (!isPrefabSlug(slug)) return Response.json({ error: "no such prefab" }, { status: 404 });
  return editPrefab(request, prefabDeps(), slug);
}

export { handle as PATCH, handle as DELETE };
