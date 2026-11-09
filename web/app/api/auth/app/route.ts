// GET /api/auth/app?redirect_uri=&state=&code_challenge=: a desktop app's player off to Steam's
// login, to come back to the app (lib/auth.ts, ADR 0017).
import { connection } from "next/server";

import { startAppSignIn } from "../../../../lib/auth";

export async function GET(request: Request) {
  await connection();
  return startAppSignIn(request);
}
