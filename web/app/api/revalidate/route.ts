// POST /api/revalidate with `Authorization: Bearer $REVALIDATE_SECRET`: the collector
// calls it once a Refresh or a Daily read has committed, and the cached reads it changed
// (db/data.ts; tagsToExpire) are read fresh on their next request. 401 for a missing or
// wrong secret, or none configured.
import { revalidateTag } from "next/cache";

import { authorized } from "./auth";
import { tagsToExpire } from "./tags";

export function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"), process.env.REVALIDATE_SECRET))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const tags = tagsToExpire(new URL(request.url).searchParams);
  // expire now rather than serve stale: a write has just landed, so the next read
  // should show it
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  return Response.json({ revalidated: tags });
}
