// GET /api/maps?q=: the Workshop homepage's search. Every Map with a time whose title or
// creator contains q, most runs first: how many match, and the first MAPS_CHUNK of them.
import { getMapCards } from "../../../db/data";
import { MAPS_CHUNK, searchMaps } from "../../../lib/workshop";

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 64);
  const hits = q ? searchMaps(await getMapCards(), q) : [];
  return Response.json({ total: hits.length, maps: hits.slice(0, MAPS_CHUNK) });
}
