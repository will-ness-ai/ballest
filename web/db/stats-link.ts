// The Stats Link's site side (CONTEXT.md, ADR 0014): Multiballs writes a link request when an
// unpaired player presses See my stats, and sends them to /discord/link?t=<token>. The page
// says what linkPageOf finds, and its confirm button POSTs /api/discord/link?t=<token>
// (confirmLink), which pairs that Discord account with the signed-in Steam ID. `deps` carries
// the database and what the tests stand in for: the session's secret and clock, and Steam.
import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";

import { isCrossSite, sessionOf, type AuthEnv } from "../lib/auth";
import { statsLinkHref } from "../lib/routes";
import type { Db } from "./client";
import { steamPersona } from "./prefab-api";
import { players, statsLinkRequests, statsLinks } from "./schema";

export interface StatsLinkDeps {
  db: Db;
  auth?: AuthEnv;
  /* a Steam ID's persona from its Steam profile, for a player on no board */
  persona?: (steamId: string) => Promise<string | null>;
}

/* how long a link request can be used: Discord's interaction token, which Multiballs edits
   its answer with, lasts as long */
export const REQUEST_MS = 15 * 60_000;

/* how long a request is kept: a day, so an expired link still says it has expired and a
   reloaded Done page still says done, rather than reading as a link that never worked */
export const KEEP_MS = 24 * 60 * 60_000;

/* what the link page says: a token nobody wrote (or pruned after a day), one too old or
   already used, "done" to the reader whose confirm used it, and otherwise who is being paired */
export type LinkPage =
  | { state: "bad" | "expired" | "used" | "done" }
  | { state: "signed-out"; discord: string }
  | { state: "confirm"; discord: string; steamId: string; persona: string };

const now = (deps: StatsLinkDeps) => deps.auth?.now ?? Date.now();

/* a token as Multiballs writes it is 32 hex characters; anything far off isn't looked up */
const tokenOf = (t: string | null | undefined) => (t && /^[\w-]{1,64}$/.test(t) ? t : null);

/* the link page for `token`, read by `steamId` (null signed out) */
export async function linkPageOf(
  deps: StatsLinkDeps,
  token: string | null | undefined,
  steamId: string | null,
): Promise<LinkPage> {
  const t = tokenOf(token);
  if (!t) return { state: "bad" };
  const request = (
    await deps.db
      .select({
        discordName: statsLinkRequests.discordName,
        createdAt: statsLinkRequests.createdAt,
        usedAt: statsLinkRequests.usedAt,
        pairedWith: statsLinks.steamId,
      })
      .from(statsLinkRequests)
      .leftJoin(statsLinks, eq(statsLinks.discordId, statsLinkRequests.discordId))
      .where(eq(statsLinkRequests.token, t))
  ).at(0);
  if (!request) return { state: "bad" };
  if (request.usedAt) return { state: steamId && request.pairedWith === steamId ? "done" : "used" };
  if (request.createdAt.getTime() <= now(deps) - REQUEST_MS) return { state: "expired" };
  if (!steamId) return { state: "signed-out", discord: request.discordName };
  return {
    state: "confirm",
    discord: request.discordName,
    steamId,
    persona: await personaOf(deps, steamId),
  };
}

/* the name a Steam ID goes by on the boards, else on its Steam profile, else the ID itself */
async function personaOf(deps: StatsLinkDeps, steamId: string): Promise<string> {
  const player = (
    await deps.db
      .select({ persona: players.persona })
      .from(players)
      .where(eq(players.steamId, steamId))
  ).at(0);
  if (player) return player.persona;
  return (await (deps.persona ?? steamPersona)(steamId).catch(() => null)) ?? steamId;
}

/* POST /api/discord/link?t=<token>: the signed-in reader confirms. The request is marked used
   and the Stats Link written (replacing any) in one transaction, so a token pairs once; the
   requests older than KEEP_MS are pruned. Refused from another site; otherwise the reader
   goes back to the link page, which says what came of it (done, or why not) */
export async function confirmLink(request: Request, deps: StatsLinkDeps): Promise<Response> {
  if (isCrossSite(request))
    return Response.json(
      { error: "cross-site" },
      { status: 403, headers: { "cache-control": "private, no-store" } },
    );
  const token = new URL(request.url).searchParams.get("t");
  const steamId = sessionOf(request, deps.auth);
  const t = tokenOf(token);
  if (t && steamId) {
    const at = new Date(now(deps));
    const oldest = new Date(at.getTime() - REQUEST_MS);
    await deps.db.transaction(async (tx) => {
      const used = (
        await tx
          .update(statsLinkRequests)
          .set({ usedAt: at })
          .where(
            and(
              eq(statsLinkRequests.token, t),
              isNull(statsLinkRequests.usedAt),
              gt(statsLinkRequests.createdAt, oldest),
            ),
          )
          .returning({ discordId: statsLinkRequests.discordId })
      ).at(0);
      if (used)
        await tx
          .insert(statsLinks)
          .values({ discordId: used.discordId, steamId, linkedAt: at })
          .onConflictDoUpdate({
            target: statsLinks.discordId,
            set: { steamId, linkedAt: sql`excluded.linked_at` },
          });
      await tx
        .delete(statsLinkRequests)
        .where(lte(statsLinkRequests.createdAt, new Date(at.getTime() - KEEP_MS)));
    });
  }
  return new Response(null, {
    status: 303,
    headers: { location: statsLinkHref(token ?? ""), "cache-control": "private, no-store" },
  });
}
