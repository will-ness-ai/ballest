// The Chosen Skin API (CONTEXT.md): PUT /api/me/skin with { skin } saves the signed-in
// player's pick, DELETE clears it, from a Request to its Response, so the tests can make the
// same calls against a throwaway database. `deps` carries the database and what the tests
// stand in for: the session's secret and clock, and the cache to expire after a save.
import { count, eq, lte, sql } from "drizzle-orm";

import { isCrossSite, sessionOf, type AuthEnv } from "../lib/auth";
import { skinPicture } from "../lib/skins";
import type { Db } from "./client";
import { chosenSkinSaves, chosenSkins } from "./schema";

export interface ChosenSkinDeps {
  db: Db;
  auth?: AuthEnv;
  /* expires the cached Chosen Skins */
  changed?: () => void;
}

/* how many saves, picks and clears alike, a player may make in a rolling hour: enough to
   change their mind, few enough that one account can't keep expiring the cache */
export const HOURLY_SAVES = 10;
const SAVE_WINDOW_MS = 3_600_000;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

const now = (deps: ChosenSkinDeps) => deps.auth?.now ?? Date.now();

/* the Skin a PUT names, or undefined when the site has no picture for it */
function skinOf(body: unknown): string | undefined {
  const skin = (body as { skin?: unknown } | null)?.skin;
  return typeof skin === "string" && skinPicture(skin) ? skin : undefined;
}

/* PUT or DELETE /api/me/skin: { skin }, the Skin now saved, null for none. Refused signed out,
   from another site, for a Skin the site has no picture for, and over the hourly limit */
export async function chooseSkin(request: Request, deps: ChosenSkinDeps): Promise<Response> {
  if (isCrossSite(request)) return json({ error: "cross-site" }, 403);
  const id = sessionOf(request, deps.auth);
  if (!id) return json({ error: "sign in with Steam" }, 401);
  const skin = request.method === "DELETE" ? null : skinOf(await request.json().catch(() => null));
  if (skin === undefined) return json({ error: "no such skin" }, 400);
  const at = new Date(now(deps));
  const saved = await deps.db.transaction(async (tx) => {
    /* one save at a time per player, so two at once can't both take the last one */
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"chosen-skin:" + id}))`);
    await tx
      .delete(chosenSkinSaves)
      .where(lte(chosenSkinSaves.savedAt, new Date(at.getTime() - SAVE_WINDOW_MS)));
    const [{ n }] = await tx
      .select({ n: count() })
      .from(chosenSkinSaves)
      .where(eq(chosenSkinSaves.steamId, id));
    if (n >= HOURLY_SAVES) return false;
    await tx.insert(chosenSkinSaves).values({ steamId: id, savedAt: at });
    if (skin === null) await tx.delete(chosenSkins).where(eq(chosenSkins.steamId, id));
    else
      await tx
        .insert(chosenSkins)
        .values({ steamId: id, skin, chosenAt: at })
        .onConflictDoUpdate({ target: chosenSkins.steamId, set: { skin, chosenAt: at } });
    return true;
  });
  if (!saved) return json({ error: "that's your saves for the last hour" }, 429);
  deps.changed?.();
  return json({ skin });
}
