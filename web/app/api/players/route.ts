// GET /api/players?q=&except=: up to ten players whose persona or Steam ID contains q, the
// names that start with it first, leaving out `except` (the player staying put). The
// Compare dialog's search (components/player/Compare.tsx).
import { searchPlayers } from "../../../db/data";
import { isSteamId } from "../../../lib/rules";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 64);
  const except = url.searchParams.get("except") ?? "";
  if (!q) return Response.json([]);
  return Response.json(await searchPlayers(q, isSteamId(except) ? except : ""));
}
