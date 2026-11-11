// GET /api/auth/app/return: where Steam sends an app's player back, on their way to the app
// (lib/auth.ts, ADR 0017).
import { connection } from "next/server";

import { finishAppSignIn } from "../../../../../lib/auth";

export async function GET(request: Request) {
  await connection();
  return finishAppSignIn(request);
}
