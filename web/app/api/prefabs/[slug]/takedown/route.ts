// POST /api/prefabs/<slug>/takedown: the admin takes a Prefab down (db/prefab-api.ts
// takeDownPrefab). Never cached.
import { connection } from "next/server";

import { prefabDeps } from "../../../../../db/data";
import { takeDownPrefab } from "../../../../../db/prefab-api";
import { isPrefabSlug } from "../../../../../lib/routes";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  if (!isPrefabSlug(slug)) return Response.json({ error: "no such prefab" }, { status: 404 });
  return takeDownPrefab(request, prefabDeps(), slug);
}
