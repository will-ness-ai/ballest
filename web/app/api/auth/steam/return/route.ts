// GET /api/auth/steam/return: where Steam sends the reader back (lib/auth.ts).
import { connection } from "next/server";

import { finishSignIn } from "../../../../../lib/auth";

export async function GET(request: Request) {
  await connection();
  return finishSignIn(request);
}
