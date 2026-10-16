// GET /api/campaign/<slug>: the IDs of a curated Campaign's Maps the Workshop lists, in its
// order, from the cached read its page makes. 404 for a slug that isn't curated or a
// Campaign none of whose Maps is listed, as its page is. proxy.ts asks it before a
// Campaign's page streams, since the proxy can't read the cache itself.
import { getCampaign } from "../../../../db/data";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const data = await getCampaign((await params).slug);
  if (!data) return Response.json({ error: "no such campaign" }, { status: 404 });
  return Response.json({ maps: data.maps.map((m) => m.pfid) });
}
