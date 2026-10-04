// GET /api/board/<name>?from=&count=&q=: a slice of a board in rank order, for the list
// that grows as the reader scrolls (components/board/BoardBody). With q, only the rows
// whose persona or Steam ID contains it, each keeping its real rank and interval. A
// Circuit board or a listed Map's; anything else is a 404.
import { isBoard, readBoard, searchBoard } from "../../../../db/data";

/* a search pages its matches; a link to a player's row reads down to it in one go, as far
   as the largest board goes */
const MAX_SEARCH = 200,
  MAX_READ = 20_000;

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!(await isBoard(name))) return Response.json({ error: "no such board" }, { status: 404 });
  const url = new URL(request.url);
  const from = Math.max(0, Math.floor(Number(url.searchParams.get("from")) || 0));
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 64);
  const count = Math.min(
    q ? MAX_SEARCH : MAX_READ,
    Math.max(1, Math.floor(Number(url.searchParams.get("count")) || 50)),
  );
  return Response.json(
    q ? await searchBoard(name, q, from, count) : await readBoard(name, from, count),
  );
}
