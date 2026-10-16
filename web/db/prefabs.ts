// Prefabs in the site's database (ADR 0009): the reads behind a Prefab's page and the gallery,
// and the writes the API routes make. Each takes the database it works on, so the tests can
// run it against a throwaway one. Results are plain JSON, because db/data.ts caches the reads.
import { sql, type SQL } from "drizzle-orm";

import { slugOf } from "../lib/prefab-check";
import type { Db } from "./client";
import { prefabs } from "./schema";

async function rows<T>(db: Db, query: SQL): Promise<Array<T>> {
  return (await db.execute(query)).rows as Array<T>;
}

export interface Uploader {
  steamId: string;
  name: string;
  /* whether the boards have seen them, so the byline can link their player page */
  isPlayer: boolean;
}

export interface PrefabView {
  slug: string;
  name: string;
  description: string;
  tags: Array<string>;
  uploader: Uploader;
  file: string;
  pieces: number;
  bytes: number;
  favorites: number;
  createdAt: string;
}

export interface NewPrefab {
  name: string;
  description: string;
  tags: Array<string>;
  uploader: string;
  uploaderName: string | null;
  file: string;
}

/* store a Prefab under the first free slug its name gives */
export async function addPrefab(db: Db, p: NewPrefab): Promise<{ slug: string }> {
  const base = slugOf(p.name);
  const taken = new Set(
    (
      await rows<{ slug: string }>(
        db,
        sql`select slug from prefabs where slug = ${base} or slug ~ ${`^${base}-[0-9]+$`}`,
      )
    ).map((r) => r.slug),
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${String(n)}`;
  await db.insert(prefabs).values({
    ...p,
    slug,
    pieces: (JSON.parse(p.file) as { items: Array<unknown> }).items.length,
    bytes: Buffer.byteLength(p.file),
  });
  return { slug };
}

/* a Prefab by its slug, or null for one nobody uploaded */
export async function prefabOf(db: Db, slug: string): Promise<PrefabView | null> {
  const found = await rows<PrefabView>(
    db,
    sql`
      select p.slug, p.name, p.description, p.tags, p.file, p.pieces, p.bytes,
        to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",
        json_build_object(
          'steamId', p.uploader,
          'name', coalesce(pl.persona, p.uploader_name, p.uploader),
          'isPlayer', pl.steam_id is not null
        ) as uploader,
        (select count(*)::int from prefab_favorites f where f.prefab_id = p.id) as favorites
      from prefabs p left join players pl on pl.steam_id = p.uploader
      where p.slug = ${slug}`,
  );
  return found.at(0) ?? null;
}
