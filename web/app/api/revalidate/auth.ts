import { timingSafeEqual } from "node:crypto";

// Whether an Authorization header carries `Bearer <secret>`. With no secret configured
// nothing passes, so a deploy missing REVALIDATE_SECRET can't be revalidated by anyone.
// Whitespace around either side is ignored, so a pasted secret's stray newline can't
// break it. The 401s of 2026-10-04..08 were two different values, fixed by setting one
// value in both GitHub and Vercel; a changed Vercel value reaches the site only with a
// new production deploy.
export function authorized(header: string | null, secret: string | undefined): boolean {
  const want = Buffer.from(secret?.trim() ?? "");
  if (want.length === 0 || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length).trim());
  return given.length === want.length && timingSafeEqual(given, want);
}
