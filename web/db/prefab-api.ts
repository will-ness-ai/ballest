// The Prefab API (ADR 0009): each route under app/api/prefabs is one call here, from a
// Request to its Response, so the tests can make the same calls against a throwaway
// database. Every write checks the Sign in with Steam session (lib/auth.ts) and refuses a
// request another site sent. `deps` carries the database and what the tests stand in for:
// the session's secret and clock, the ops ping, the uploader's Steam persona, and the cache
// to expire after a write.
import { and, eq, isNull, sql } from "drizzle-orm";

import { isCrossSite, sessionOf, type AuthEnv } from "../lib/auth";
import { checkPrefab } from "../lib/prefab-check";
import {
  ADMIN_STEAM_ID,
  DAILY_UPLOADS,
  UPLOAD_WINDOW_MS,
  checkFields,
  type PrefabFields,
} from "../lib/prefabs";
import { SITE_ORIGIN, prefabHref } from "../lib/routes";
import { isSteamId } from "../lib/rules";
import type { Db } from "./client";
import { LIVE, addPrefab, prefabOf, type Conn } from "./prefabs";
import { prefabBans, prefabs } from "./schema";

export interface PrefabDeps {
  db: Db;
  auth?: AuthEnv;
  /* posts a line to the ops Discord channel */
  ping?: (text: string) => Promise<void>;
  /* a Steam ID's persona on Steam, or null */
  persona?: (steamId: string) => Promise<string | null>;
  /* expires the cached Prefab reads */
  changed?: () => void;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

/* how many uploads `steamId` has left now and, at none, when the next frees up */
async function quotaOf(db: Conn, steamId: string, now: number) {
  const since = new Date(now - UPLOAD_WINDOW_MS).toISOString();
  const { rows } = await db.execute(sql`
    select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
    from prefabs where uploader = ${steamId} and created_at > ${since}
    order by created_at`);
  const times = (rows as Array<{ at: string }>).map((r) => r.at);
  const left = Math.max(0, DAILY_UPLOADS - times.length);
  const oldest = times.at(-DAILY_UPLOADS);
  return {
    left,
    nextAt: left || !oldest ? null : new Date(Date.parse(oldest) + UPLOAD_WINDOW_MS).toISOString(),
  };
}

async function isBanned(db: Conn, steamId: string) {
  const { rows } = await db.execute(sql`select 1 from prefab_bans where steam_id = ${steamId}`);
  return rows.length > 0;
}

/* GET /api/prefabs: what the upload form tells the reader before they start */
export async function uploadQuota(request: Request, deps: PrefabDeps): Promise<Response> {
  const id = sessionOf(request, deps.auth);
  if (!id) return json({ signedIn: false, banned: false, left: 0, nextAt: null });
  if (await isBanned(deps.db, id))
    return json({ signedIn: true, banned: true, left: 0, nextAt: null });
  return json({ signedIn: true, banned: false, ...(await quotaOf(deps.db, id, now(deps))) });
}

const now = (deps: PrefabDeps) => deps.auth?.now ?? Date.now();

/* the upload form's fields, or null when the body isn't one; the file's size is the upload
   check's to refuse (Vercel caps a request body at 4.5 MB before it gets here) */
async function formOf(request: Request): Promise<(PrefabFields & { file: string }) | null> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const text = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : "";
    };
    if (!(file instanceof Blob)) return null;
    return {
      name: text("name"),
      description: text("description"),
      tags: form.getAll("tags").filter((v) => typeof v === "string"),
      file: await file.text(),
    };
  } catch {
    return null;
  }
}

/* POST /api/prefabs: the upload form. Live at once (U2), so ops gets a ping; refused signed
   out, from another site, banned, over the daily limit, or with a file or fields that fail
   their checks */
export async function uploadPrefab(request: Request, deps: PrefabDeps): Promise<Response> {
  if (isCrossSite(request)) return json({ error: "cross-site" }, 403);
  const id = sessionOf(request, deps.auth);
  if (!id) return json({ error: "sign in with Steam to upload" }, 401);
  const form = await formOf(request);
  if (!form) return json({ problems: ["That upload didn't arrive whole. Try again."] }, 400);
  const file = checkPrefab(form.file);
  const fields = checkFields(form);
  if (!file.ok || !fields.ok)
    return json(
      { problems: [...(file.ok ? [] : file.problems), ...(fields.ok ? [] : fields.problems)] },
      400,
    );
  const uploaderName = await (deps.persona ?? steamPersona)(id).catch(() => null);
  const result = await deps.db.transaction(async (tx) => {
    /* one upload at a time per player, so two at once can't both take the last slot */
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"prefab-upload:" + id}))`);
    if (await isBanned(tx, id)) return { status: 403 as const };
    const quota = await quotaOf(tx, id, now(deps));
    if (!quota.left) return { status: 429 as const, nextAt: quota.nextAt };
    const { slug } = await addPrefab(tx, {
      ...fields.fields,
      uploader: id,
      uploaderName,
      file: form.file,
      createdAt: new Date(now(deps)),
    });
    return { status: 201 as const, slug };
  });
  if (result.status === 403) return json({ error: "you can't upload prefabs" }, 403);
  if (result.status === 429)
    return json({ error: "that's today's uploads", nextAt: result.nextAt }, 429);
  deps.changed?.();
  const name = (await prefabOf(deps.db, result.slug))?.uploader.name;
  await (deps.ping ?? opsPing)(
    `New prefab: **${fields.fields.name}** (${String(file.pieces)} pieces) by ${name ?? id}\n${SITE_ORIGIN}${prefabHref(result.slug)}`,
  ).catch((e: unknown) => console.warn("prefab ping failed:", e));
  return json({ slug: result.slug }, 201);
}

/* a Steam ID's persona from its public community profile, or null */
async function steamPersona(steamId: string): Promise<string | null> {
  const r = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!r.ok) return null;
  const m = /<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/.exec(await r.text());
  return m?.[1].trim().slice(0, 64) || null; // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- an empty persona is none
}

/* posts to the ops Discord channel's webhook; skipped, with a log line, when it isn't set */
async function opsPing(text: string): Promise<void> {
  const url = process.env.OPS_WEBHOOK_URL;
  if (!url) {
    console.log("prefab ping skipped: OPS_WEBHOOK_URL is not set");
    return;
  }
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(5000),
  });
}

/* a live Prefab's id and uploader by its slug, or null: deleted, taken down and hidden
   ones can't be hearted or edited */
async function liveOf(db: Conn, slug: string): Promise<{ id: number; uploader: string } | null> {
  const { rows } = await db.execute(
    sql`select p.id, p.uploader from prefabs p where p.slug = ${slug} and ${LIVE}`,
  );
  return (rows as Array<{ id: number; uploader: string }>).at(0) ?? null;
}

/* GET, PUT and DELETE /api/prefabs/<slug>/favorite: whether the reader has hearted it and
   how many have; PUT hearts it, DELETE takes the heart back. Signed out, GET only counts */
export async function favoritePrefab(
  request: Request,
  deps: PrefabDeps,
  slug: string,
): Promise<Response> {
  const write = request.method !== "GET";
  if (write && isCrossSite(request)) return json({ error: "cross-site" }, 403);
  const id = sessionOf(request, deps.auth);
  if (write && !id) return json({ error: "sign in with Steam to favorite" }, 401);
  const prefab = (await liveOf(deps.db, slug))?.id;
  if (prefab === undefined) return json({ error: "no such prefab" }, 404);
  if (id && request.method === "PUT")
    await deps.db.execute(sql`
      insert into prefab_favorites (prefab_id, steam_id) values (${prefab}, ${id})
      on conflict do nothing`);
  if (id && request.method === "DELETE")
    await deps.db.execute(
      sql`delete from prefab_favorites where prefab_id = ${prefab} and steam_id = ${id}`,
    );
  if (write) deps.changed?.();
  const { rows } = await deps.db.execute(sql`
    select count(*)::int as favorites, coalesce(bool_or(steam_id = ${id ?? ""}), false) as on
    from prefab_favorites where prefab_id = ${prefab}`);
  return json((rows as Array<{ on: boolean; favorites: number }>)[0]);
}

/* PATCH /api/prefabs/<slug> with { name, description, tags }: the uploader edits what the
   gallery and page say (the file and the link stay). DELETE: the uploader deletes it; its
   row stays, so it still counts against their daily limit, and its page reads gone */
export async function editPrefab(
  request: Request,
  deps: PrefabDeps,
  slug: string,
): Promise<Response> {
  if (isCrossSite(request)) return json({ error: "cross-site" }, 403);
  const id = sessionOf(request, deps.auth);
  if (!id) return json({ error: "sign in with Steam" }, 401);
  const prefab = await liveOf(deps.db, slug);
  if (!prefab) return json({ error: "no such prefab" }, 404);
  if (prefab.uploader !== id) return json({ error: "only its uploader can change it" }, 403);
  const at = new Date(now(deps)).toISOString();
  if (request.method === "DELETE") {
    await deps.db.execute(sql`update prefabs set deleted_at = ${at} where id = ${prefab.id}`);
    deps.changed?.();
    return json({ deleted: slug });
  }
  const body = (await request.json().catch(() => null)) as Partial<PrefabFields> | null;
  const fields = checkFields({
    name: typeof body?.name === "string" ? body.name : "",
    description: typeof body?.description === "string" ? body.description : "",
    tags: Array.isArray(body?.tags) ? body.tags.filter((t) => typeof t === "string") : [],
  });
  if (!fields.ok) return json({ problems: fields.problems }, 400);
  const { name, description, tags } = fields.fields;
  await deps.db
    .update(prefabs)
    .set({ name, description, tags, updatedAt: new Date(at) })
    .where(eq(prefabs.id, prefab.id));
  deps.changed?.();
  return json({ slug });
}

/* the admin's Steam ID when the request is theirs, from this site; else the refusal */
function asAdmin(request: Request, deps: PrefabDeps): string | Response {
  if (isCrossSite(request)) return json({ error: "cross-site" }, 403);
  const id = sessionOf(request, deps.auth);
  if (!id) return json({ error: "sign in with Steam" }, 401);
  if (id !== ADMIN_STEAM_ID) return json({ error: "only the admin can do that" }, 403);
  return id;
}

/* POST /api/prefabs/<slug>/takedown: the admin takes a Prefab down (B1). Its row stays,
   stamped, and its page reads gone */
export async function takeDownPrefab(
  request: Request,
  deps: PrefabDeps,
  slug: string,
): Promise<Response> {
  const admin = asAdmin(request, deps);
  if (admin instanceof Response) return admin;
  const at = new Date(now(deps));
  const done = await deps.db
    .update(prefabs)
    .set({ takenDownAt: at })
    .where(and(eq(prefabs.slug, slug), isNull(prefabs.takenDownAt)))
    .returning({ id: prefabs.id });
  if (!done.length) return json({ error: "no such prefab" }, 404);
  deps.changed?.();
  return json({ takenDown: slug });
}

/* PUT /api/prefab-bans/<steam_id>: the admin stops a player uploading, which hides every
   Prefab they uploaded; DELETE lifts the ban and brings them back (B1) */
export async function banUploader(
  request: Request,
  deps: PrefabDeps,
  steamId: string,
): Promise<Response> {
  const admin = asAdmin(request, deps);
  if (admin instanceof Response) return admin;
  if (!isSteamId(steamId)) return json({ error: "not a Steam ID" }, 400);
  if (steamId === admin) return json({ error: "you can't ban yourself" }, 400);
  if (request.method === "DELETE")
    await deps.db.delete(prefabBans).where(eq(prefabBans.steamId, steamId));
  else
    await deps.db
      .insert(prefabBans)
      .values({ steamId, bannedBy: admin, bannedAt: new Date(now(deps)) })
      .onConflictDoNothing();
  deps.changed?.();
  return json({ steamId, banned: request.method !== "DELETE" });
}
