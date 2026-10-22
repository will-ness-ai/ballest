// PROTOTYPE (grill-design, never merged): GET /og/stat/<steam id>?variant=A..E draws one of
// the stat card variants for the Discord stat card channel.
import { drawStat, isVariant, skinOf, statOf } from "../../../../components/prototype/StatCard";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = new URL(request.url).searchParams;
  const v = q.get("variant") ?? "A";
  if (!isVariant(v)) return new Response("no such variant", { status: 404 });
  const s = await statOf(id);
  if (!s) return new Response("no such player", { status: 404 });
  return drawStat({ ...s, skin: await skinOf(q.get("skin")) }, v);
}
