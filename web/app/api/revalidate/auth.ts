import { timingSafeEqual } from "node:crypto";

// Whether an Authorization header carries `Bearer <secret>`. With no secret configured
// nothing passes, so a deploy missing REVALIDATE_SECRET can't be revalidated by anyone.
export function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}
