// How often the game may sign in (ADR 0016). Every sign-in asks Steam about its ticket with the
// site's Web API key, which has a daily quota, so anyone posting tickets in a loop would
// otherwise spend it for everyone. Kept in `game_sign_ins` for an hour, the way the Chosen
// Skin's saves are (db/chosen-skin-api.ts): so many per address, and so many in all.
import { count, eq, lte, sql } from "drizzle-orm";

import type { Db } from "./client";
import { gameSignIns } from "./schema";

/* a player starts the game, and signs in again on a 401, a few times an hour; a shared
   address (a LAN, a school) has room for many */
export const HOURLY_GAME_SIGN_INS = 30;
/* everyone's together: under half of Steam's 100,000 Web API calls a day, so a crowd of
   addresses can't spend the key's quota either */
export const HOURLY_GAME_SIGN_INS_ALL = 2000;
const WINDOW_MS = 3_600_000;

/* the address a request came from, as limited: Vercel sets x-real-ip, and the first
   x-forwarded-for, from the connection itself, whatever the client sent. An IPv6 address
   counts by its /64, the block one home or server is given, so its many addresses are one */
export function addressOf(request: Request): string {
  /* an empty header is no address */
  const given = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);
  const address =
    given(request.headers.get("x-real-ip") ?? undefined) ??
    given(request.headers.get("x-forwarded-for")?.split(",")[0]) ??
    "unknown";
  /* an IPv4 address written as IPv6 (::ffff:a.b.c.d) is that IPv4 address */
  const v4 = /^(?:\[)?::ffff:(\d{1,3}(?:\.\d{1,3}){3})\]?$/i.exec(address)?.[1];
  if (v4) return v4;
  return address.includes(":") ? blockOf(address) : address;
}

/* an IPv6 address's first four groups, written out in full, as "<groups>::/64" */
function blockOf(address: string): string {
  const bare = address
    .replace(/^\[|\](:\d+)?$/g, "")
    .split("%")[0]
    .toLowerCase();
  const [head, tail] = bare.split("::");
  const groups = (s: string | undefined) => (s ? s.split(":") : []);
  const fill = 8 - groups(head).length - groups(tail).length;
  const all = !bare.includes("::")
    ? groups(head)
    : [...groups(head), ...Array<string>(Math.max(fill, 0)).fill("0"), ...groups(tail)];
  return all
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")
    .concat("::/64");
}

/* whether `address` may sign in now, counting this one if so: under one lock for everyone,
   so the cap on all can't be passed by many at once either */
export async function spendGameSignIn(db: Db, address: string, now: number): Promise<boolean> {
  const at = new Date(now);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('game-sign-in'))`);
    await tx.delete(gameSignIns).where(lte(gameSignIns.signedAt, new Date(now - WINDOW_MS)));
    const [{ all }] = await tx.select({ all: count() }).from(gameSignIns);
    if (all >= HOURLY_GAME_SIGN_INS_ALL) return false;
    const [{ n }] = await tx
      .select({ n: count() })
      .from(gameSignIns)
      .where(eq(gameSignIns.address, address));
    if (n >= HOURLY_GAME_SIGN_INS) return false;
    await tx.insert(gameSignIns).values({ address, signedAt: at });
    return true;
  });
}
