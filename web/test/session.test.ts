import { expect, test } from "vitest";

import { cookieOf, redirectTo, sessionCookies, sessionOf, sign, verify } from "../lib/session";

const ID = "76561198008697957";
const NOW = Date.UTC(2026, 9, 8);
const DAY = 86_400_000;

test("a signed session verifies as its Steam ID under the same secret", () => {
  const t = sign(ID, "s3cret", NOW);
  expect(verify(t, "s3cret", NOW)).toBe(ID);
  expect(verify(t, "s3cret\n", NOW + DAY)).toBe(ID);
});

test("an altered, foreign or malformed session verifies as nobody", () => {
  const t = sign(ID, "s3cret", NOW) ?? "";
  expect(verify(t, "other", NOW)).toBeNull();
  expect(verify(t.replace(ID, "76561198008697958"), "s3cret", NOW)).toBeNull();
  const [, issued, sig] = t.split(".");
  expect(verify(`${ID}.${Number(issued) + 1}.${sig}`, "s3cret", NOW)).toBeNull();
  expect(verify(t + ".x", "s3cret", NOW)).toBeNull();
  expect(verify(`${ID}.${issued}`, "s3cret", NOW)).toBeNull();
  expect(verify("", "s3cret", NOW)).toBeNull();
  expect(verify(null, "s3cret", NOW)).toBeNull();
});

test("a session lasts a year, and one from the future doesn't count", () => {
  const t = sign(ID, "s3cret", NOW);
  expect(verify(t, "s3cret", NOW + 364 * DAY)).toBe(ID);
  expect(verify(t, "s3cret", NOW + 366 * DAY)).toBeNull();
  expect(verify(t, "s3cret", NOW - DAY)).toBeNull();
});

test("with no secret nobody signs in", () => {
  expect(sign(ID, undefined, NOW)).toBeNull();
  expect(sign(ID, " \n", NOW)).toBeNull();
  expect(verify(sign(ID, "s3cret", NOW), undefined, NOW)).toBeNull();
  expect(sign("not-an-id", "s3cret", NOW)).toBeNull();
});

const asking = (cookie: string) => new Request("https://x.test/api/me", { headers: { cookie } });

test("cookies are read by exact name", () => {
  expect(cookieOf(asking("a=1; ballest-session=x.y.z; b=2"), "ballest-session")).toBe("x.y.z");
  expect(cookieOf(asking("xballest-session=1"), "ballest-session")).toBeNull();
  expect(cookieOf(new Request("https://x.test/"), "ballest-session")).toBeNull();
});

test("a request is signed in as its session's Steam ID; a bad session is stale", () => {
  const t = sign(ID, "s3cret", NOW) ?? "";
  expect(sessionOf(asking("ballest-session=" + t), "s3cret", NOW)).toEqual({
    id: ID,
    stale: false,
  });
  expect(sessionOf(asking("ballest-session=" + t + "x"), "s3cret", NOW)).toEqual({
    id: null,
    stale: true,
  });
  expect(sessionOf(asking(""), "s3cret", NOW)).toEqual({ id: null, stale: false });
});

test("with no secret configured a session is unreadable but not stale, so it is kept", () => {
  const t = sign(ID, "s3cret", NOW) ?? "";
  expect(sessionOf(asking("ballest-session=" + t), undefined, NOW)).toEqual({
    id: null,
    stale: false,
  });
});

test("a redirect goes only to a path on this site", () => {
  expect(redirectTo("/maps", ["a=1"]).headers.get("location")).toBe("/maps");
  expect(redirectTo("//evil.example").headers.get("location")).toBe("/");
  expect(redirectTo(null).status).toBe(303);
});

test("signing in sets an httpOnly session and a readable hint; signing out clears both", () => {
  const [session, hint] = sessionCookies("tok");
  expect(session).toMatch(
    /^ballest-session=tok; HttpOnly; .*Max-Age=31536000; Secure; SameSite=Lax$/,
  );
  expect(hint).toMatch(/^ballest-in=1; Path=\//);
  expect(hint).not.toMatch(/HttpOnly/);
  for (const c of sessionCookies(null)) expect(c).toMatch(/=; .*Max-Age=0;/);
});
