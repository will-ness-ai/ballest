// POST /api/auth/app/token: a desktop app trades its sign-in code for an app token (lib/auth.ts,
// ADR 0017), counted against the game's sign-ins (db/game-sign-in.ts). Never cached.
import { connection } from "next/server";

import { gameSignInDeps } from "../../../../../db/data";
import { signInFromApp } from "../../../../../lib/auth";

export async function POST(request: Request) {
  await connection();
  return signInFromApp(request, gameSignInDeps());
}
