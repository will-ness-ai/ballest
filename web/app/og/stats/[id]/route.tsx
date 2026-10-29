// GET /og/stats/<steam id>?v=<Refresh time>: a player's Stat Card, the image Multiballs's See
// my stats answers with (spec #323; docs/site.md, "Stat Card"). Read through the player
// page's cached reads and the Chosen Skins, and kept by Vercel's CDN for five minutes, or not
// at all when its Skin picture or avatar failed (drawStatCard): v is only the cache key, so
// each Refresh is a new address. 404 for a Steam ID that names nobody.
import { drawStatCard } from "../../../../components/share/StatCard";
import { getChosenSkins, getPlayer, getSite } from "../../../../db/data";
import { isSteamId } from "../../../../lib/rules";
import { statCard } from "../../../../lib/stat-card";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rec = isSteamId(id) ? await getPlayer(id) : null;
  if (!rec) return new Response("no such player", { status: 404 });
  const [site, chosen] = await Promise.all([getSite(), getChosenSkins()]);
  return drawStatCard(statCard(rec, site.asOf, chosen[id]));
}
