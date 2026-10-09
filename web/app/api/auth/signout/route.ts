// POST /api/auth/signout?next=<path>: signs the reader out (lib/auth.ts).
import { signOut } from "../../../../lib/auth";

export function POST(request: Request) {
  return signOut(request);
}
