// POST /api/discord/link?t=<token>: the link page's confirm, pairing the request's Discord
// account with the signed-in Steam ID (db/stats-link.ts, ADR 0014). Never cached.
import { connection } from "next/server";

import { statsLinkDeps } from "../../../../db/data";
import { confirmLink } from "../../../../db/stats-link";

export async function POST(request: Request) {
  await connection();
  return confirmLink(request, statsLinkDeps());
}
