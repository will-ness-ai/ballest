// GET /api/player/<steam_id>: a player's record (lib/player.ts), as their page builds it.
// The score card on someone else's page reads the viewer's own with it. 404 for a Steam ID
// on no board.
import { getPlayer } from "../../../../db/data";
import { isSteamId } from "../../../../lib/rules";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = isSteamId(id) ? await getPlayer(id) : null;
  if (!rec) return Response.json({ error: "no such player" }, { status: 404 });
  return Response.json(rec);
}
