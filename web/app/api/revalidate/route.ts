// POST /api/revalidate with `Authorization: Bearer $REVALIDATE_SECRET`: the collector
// calls it once a Refresh has committed, and every cached read (db/data.ts) is read
// fresh on its next request. 401 for a missing or wrong secret, or none configured.
import { revalidateTag } from "next/cache";

import { DATA_TAG } from "../../../db/data";
import { authorized } from "./auth";

export function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"), process.env.REVALIDATE_SECRET))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  // expire now rather than serve stale: a Refresh has just landed, so the next read
  // should show it
  revalidateTag(DATA_TAG, { expire: 0 });
  return Response.json({ revalidated: [DATA_TAG] });
}
