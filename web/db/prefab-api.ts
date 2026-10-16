// The Prefab API (ADR 0009): each route under app/api/prefabs is one call here, from a
// Request to its Response, so the tests can make the same calls against a throwaway
// database. Every write checks the Sign in with Steam session (lib/auth.ts) and refuses a
// request another site sent. `deps` carries the database and what the tests stand in for:
// the session's secret and clock, the ops ping, the uploader's Steam persona, and the cache
// to expire after a write.
import { sql } from "drizzle-orm";

import { isCrossSite, sessionOf, type AuthEnv } from "../lib/auth";
import { MAX_BYTES, checkPrefab } from "../lib/prefab-check";
import { DAILY_UPLOADS, UPLOAD_WINDOW_MS, checkFields, type PrefabFields } from "../lib/prefabs";
import { SITE_ORIGIN, prefabHref } from "../lib/routes";
import type { Db } from "./client";
import { addPrefab, prefabOf, type Conn } from "./prefabs";

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

/* the upload form's fields, or null when the body isn't one */
async function formOf(request: Request): Promise<(PrefabFields & { file: string }) | null> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const text = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : "";
    };
    if (!(file instanceof Blob) || file.size > MAX_BYTES + 1) return null;
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
  if (!form) return json({ problems: ["The file is over 4 MB."] }, 400);
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
