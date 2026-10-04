// GET /api/db/board/<name>: a board's current Entries from the database, as the read
// layer gives them (db/data.ts). Internal, so a preview can show the database working;
// the page itself still reads data/.
import { getBoard } from "../../../../../db/data";

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const board = await getBoard(name);
  if (!board) return Response.json({ error: `no board named ${name}` }, { status: 404 });
  return Response.json(board);
}
