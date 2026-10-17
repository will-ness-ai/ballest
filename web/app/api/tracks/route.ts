// GET /api/tracks: every Circuit Track's Steam leaderboard ID, in the site's order. Multiballs
// counts a player's Tracks on these boards when it previews a linked profile.
import { getTrackBoards } from "../../../db/data";

export async function GET() {
  return Response.json({ tracks: await getTrackBoards() });
}
