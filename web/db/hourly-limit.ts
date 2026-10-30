// The site's rolling-hour limits on writes anyone can repeat (ADR 0016): each Bucket counts what
// it allows in `hourly_spends`, per key (a player, an address) and, for some, in all. A spend is
// taken inside the caller's transaction under one lock per key (per Bucket when it caps all), so
// two at once can't both take the last, and a write that rolls back gives its spend back.
import { and, count, eq, lte, sql } from "drizzle-orm";

import type { Conn } from "./prefabs";
import { hourlySpends } from "./schema";

export const HOUR_MS = 3_600_000;

export interface Bucket {
  name: string;
  /* how many one key may spend in a rolling hour */
  perKey: number;
  /* how many every key together may, when there is a cap on all */
  all?: number;
}

/* spends one of `bucket`'s hour for `key` at `now` if there is one left, and says whether */
export async function spendHourly(
  tx: Conn,
  bucket: Bucket,
  key: string,
  now: number,
): Promise<boolean> {
  const lock = bucket.all === undefined ? `${bucket.name}:${key}` : bucket.name;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"hourly:" + lock}))`);
  const ours = eq(hourlySpends.bucket, bucket.name);
  await tx
    .delete(hourlySpends)
    .where(and(ours, lte(hourlySpends.spentAt, new Date(now - HOUR_MS))));
  if (bucket.all !== undefined) {
    const [{ n }] = await tx.select({ n: count() }).from(hourlySpends).where(ours);
    if (n >= bucket.all) return false;
  }
  const [{ n }] = await tx
    .select({ n: count() })
    .from(hourlySpends)
    .where(and(ours, eq(hourlySpends.key, key)));
  if (n >= bucket.perKey) return false;
  await tx.insert(hourlySpends).values({ bucket: bucket.name, key, spentAt: new Date(now) });
  return true;
}
