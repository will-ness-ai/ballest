// GET /api/auth/steam?next=<path>: off to Steam's login page (lib/auth.ts).
import { connection } from "next/server";

import { startSignIn } from "../../../../lib/auth";

export async function GET(request: Request) {
  await connection();
  return startSignIn(request);
}
