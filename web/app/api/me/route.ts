// GET /api/me: the signed-in player's Steam ID, or null (lib/auth.ts). Pages stay cached and
// the browser asks this; it is never cached.
import { connection } from "next/server";

import { whoIs } from "../../../lib/auth";

export async function GET(request: Request) {
  await connection();
  return whoIs(request);
}
