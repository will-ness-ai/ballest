// GET /api/prefabs/<slug>/thumb?v=<last edit>: a live Prefab drawn small for the game's list
// (ADR 0016), from the angle its uploader picked, clear around it, by the same GPU-free drawing
// as its share image (components/share/prefab.ts). The Prefab is found in the gallery's cached
// cards, so a slug that isn't live costs no read and leaves nothing cached. Only the address
// the list gives is drawn: any other query (an old edit's, or a made-up one) is sent there, so
// a new query string can't make the server draw it again. The picture is cached by slug and
// edit for days, apart from the Prefab reads a write expires, so the CDN keeping it only a
// minute (a Prefab taken down stops showing within the minute) costs no drawing. 404 for a
// Prefab that isn't live or can't be drawn, which the CDN also keeps a minute.
import { cacheLife, cacheTag } from "next/cache";

import { prefabPicture } from "../../../../../components/share/prefab";
import { PREFAB_FILE_TAG, getPrefabCards, prefabFileText } from "../../../../../db/data";
import type { PrefabFile } from "../../../../../lib/prefab";
import type { PrefabAngle } from "../../../../../lib/prefabs";
import { prefabThumbHref } from "../../../../../lib/routes";

/* small enough that a page of 50 costs a few megabytes, big enough for a card */
const PREFAB_THUMB = [320, 200] as const;
const MINUTE = "public, max-age=60, s-maxage=60";

const gone = (error = "no such prefab") =>
  Response.json({ error }, { status: 404, headers: { "cache-control": MINUTE } });

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const p = (await getPrefabCards()).find((c) => c.slug === slug);
  if (!p) return gone();
  const url = new URL(request.url);
  const here = prefabThumbHref(slug, p.updatedAt);
  if (url.pathname + url.search !== here)
    return new Response(null, {
      status: 307,
      headers: { location: here, "cache-control": "private, no-store" },
    });
  const png = await thumbOf(slug, p.updatedAt, p.angle).catch((e: unknown) => {
    console.warn(`prefab thumbnail: ${slug} not drawn`, e);
    return null;
  });
  if (!png) return gone("this prefab can't be drawn");
  return new Response(new Uint8Array(Buffer.from(png, "base64")), {
    headers: { "content-type": "image/png", "cache-control": MINUTE },
  });
}

/* the Prefab drawn as at its edit `updatedAt`, as base64. Its file is read fresh, so this
   entry carries no Prefab read's tag and no write throws it away. A drawing that fails throws,
   so nothing is kept for it; one that works is kept for days, and a new angle is a new edit
   and so a new entry */
async function thumbOf(
  slug: string,
  updatedAt: string,
  angle: PrefabAngle | null,
): Promise<string> {
  "use cache: remote";
  cacheTag(PREFAB_FILE_TAG);
  cacheLife("days");
  const file = await prefabFileText(slug);
  if (file === null) throw new Error(`${slug} at ${updatedAt}: no such prefab`);
  const [w, h] = PREFAB_THUMB;
  const png = await prefabPicture(JSON.parse(file) as PrefabFile, angle, w, h);
  return png.toString("base64");
}
