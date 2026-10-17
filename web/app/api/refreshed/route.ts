// GET /api/refreshed: { refreshedAt }, when the latest Refresh finished. A tab come back to
// after a while asks it before reading its page again (useLatestRefresh in hooks/client),
// so a page whose boards are still current is left as it is. It reads the same cached
// row every page's header does, expired by /api/revalidate.
import { getSite } from "../../../db/data";
import type { Freshness } from "../../../lib/rows";

export async function GET() {
  const { refreshedAt } = await getSite();
  return Response.json({ refreshedAt } satisfies Pick<Freshness, "refreshedAt">);
}
