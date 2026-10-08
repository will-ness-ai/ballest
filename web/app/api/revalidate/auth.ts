import { timingSafeEqual } from "node:crypto";

// Whether an Authorization header carries `Bearer <secret>`. With no secret configured
// nothing passes, so a deploy missing REVALIDATE_SECRET can't be revalidated by anyone.
// Whitespace around either side is ignored: a secret pasted into a dashboard with a
// trailing newline once failed every revalidation for days.
export function authorized(header: string | null, secret: string | undefined): boolean {
  const want = Buffer.from(secret?.trim() ?? "");
  if (want.length === 0 || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length).trim());
  return given.length === want.length && timingSafeEqual(given, want);
}
