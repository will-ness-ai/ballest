// GET /api/prefabs/<slug>/file: a Prefab's file exactly as it was uploaded, as an attachment
// named so the game's spawnprefab command takes it (lib/prefab-check.ts fileNameOf). The
// Prefab's page draws its viewer from the same URL.
import { getPrefabFile } from "../../../../../db/data";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const p = await getPrefabFile((await params).slug);
  if (!p) return Response.json({ error: "no such prefab" }, { status: 404 });
  return new Response(p.file, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${p.fileName}"`,
      // short: a Prefab deleted or taken down stops downloading within the minute
      "cache-control": "public, max-age=60",
    },
  });
}
