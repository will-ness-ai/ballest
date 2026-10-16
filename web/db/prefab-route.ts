// The route handlers under /api/prefabs/<slug>: never cached, a slug that can't be one is a
// 404 before the database is asked, and the handler gets the live dependencies (db/data.ts
// prefabDeps). One place, so every Prefab route answers a bad slug the same way.
import { connection } from "next/server";

import { prefabDeps } from "./data";
import type { PrefabDeps } from "./prefab-api";
import { isPrefabSlug } from "../lib/routes";

type Handler = (request: Request, deps: PrefabDeps, slug: string) => Promise<Response>;

export function prefabRoute(handler: Handler) {
  return async (request: Request, { params }: { params: Promise<{ slug: string }> }) => {
    await connection();
    const { slug } = await params;
    if (!isPrefabSlug(slug)) return Response.json({ error: "no such prefab" }, { status: 404 });
    return handler(request, prefabDeps(), slug);
  };
}
