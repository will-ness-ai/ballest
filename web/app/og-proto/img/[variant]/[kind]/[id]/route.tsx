// PROTOTYPE (grill-design, share images): /og-proto/img/<variant>/<kind>/<id> draws one card.
import { KINDS, VARIANTS, cardFor, drawCard, type Kind, type Variant } from "../../../../cards";

export async function GET(_: Request, ctx: { params: Promise<Record<string, string>> }) {
  const { variant, kind, id } = await ctx.params;
  if (!(variant in VARIANTS) || !KINDS.includes(kind as Kind))
    return new Response("no such card", { status: 404 });
  const d = await cardFor(kind as Kind, id, variant as Variant);
  if (!d) return new Response("no such page", { status: 404 });
  return drawCard(variant as Variant, d);
}
