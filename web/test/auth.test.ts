// Sign in with Steam through lib/auth.ts's four calls, as the routes make them, with a
// stand-in for Steam's check_authentication.
import { expect, test } from "vitest";

import { finishSignIn, signOut, whoIs, type AuthEnv } from "../lib/auth";
import { ENV, ID, NOW, SITE, asking, setCookies, signIn, steamSays } from "./session";

const DAY = 86_400_000;

const who = async (session: string, env: AuthEnv = ENV) => {
  const r = whoIs(asking("/api/me", { "ballest-session": session }), env);
  return { id: ((await r.json()) as { id: string | null }).id, cleared: r.headers.getSetCookie() };
};

test("starting sign-in sends the reader to Steam with a ten-minute state for this browser", async () => {
  const { started, state } = await signIn();
  expect(started.status).toBe(302);
  expect(new URL(started.headers.get("location") ?? "").origin).toBe("https://steamcommunity.com");
  expect(state).toMatch(/^[\w-]{20,}$/);
  expect(setCookies(started)["ballest-signin"]).toMatch(/HttpOnly; Path=\/; Max-Age=600; Secure/);
});

test("a login Steam confirms signs the browser in and returns it to the page it left", async () => {
  const { done, session } = await signIn();
  expect(done.status).toBe(303);
  expect(done.headers.get("location")).toBe("/board/Map_Track13");
  const c = setCookies(done);
  expect(c["ballest-session"]).toMatch(/HttpOnly; Path=\/; Max-Age=31536000; Secure; SameSite=Lax/);
  expect(c["ballest-in"]).toMatch(/^ballest-in=1; Path=\//);
  expect(c["ballest-signin"]).toMatch(/Max-Age=0/);
  expect(await who(session)).toEqual({ id: ID, cleared: [] });
});

test("a login Steam doesn't confirm, or another browser's, signs nobody in", async () => {
  const refused = await signIn(ID, { ...ENV, steam: steamSays("is_valid:false\n") });
  expect(refused.session).toBe("");
  expect(setCookies(refused.done)["ballest-signin"]).toMatch(/Max-Age=0/);
  const { returned } = await signIn();
  for (const cookies of [{}, { "ballest-signin": "someone-elses" }] as Array<
    Record<string, string>
  >) {
    const r = await finishSignIn(asking(returned, cookies), ENV);
    expect(setCookies(r)["ballest-session"]).toBeUndefined();
    expect(r.headers.get("location")).toBe("/board/Map_Track13");
  }
});

test("with no secret configured nobody signs in, and nobody already in is signed out", async () => {
  const { session } = await signIn(ID, { ...ENV, secret: undefined });
  expect(session).toBe("");
  const real = (await signIn()).session;
  expect(await who(real, { ...ENV, secret: undefined })).toEqual({ id: null, cleared: [] });
});

test("an altered, foreign or expired session is nobody, and is cleared", async () => {
  const { session } = await signIn();
  const [, issued, sig] = session.split(".");
  for (const bad of [
    session.replace(ID, "76561198008697958"),
    `${ID}.${Number(issued) + 1}.${sig}`,
    session + ".x",
    `${ID}.${issued}`,
  ]) {
    const r = await who(bad);
    expect(r.id).toBeNull();
    expect(r.cleared.join()).toMatch(/ballest-session=;.*Max-Age=0/);
  }
  expect((await who(session, { ...ENV, secret: "other" })).id).toBeNull();
  expect((await who(session, { ...ENV, now: NOW + 364 * DAY })).id).toBe(ID);
  expect((await who(session, { ...ENV, now: NOW + 366 * DAY })).id).toBeNull();
  expect((await who(session, { ...ENV, now: NOW - DAY })).id).toBeNull();
});

test("/api/me is never cached, and a browser with no session is just nobody", async () => {
  const r = whoIs(asking("/api/me"), ENV);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(await r.json()).toEqual({ id: null });
  expect(r.headers.getSetCookie()).toEqual([]);
});

test("signing out clears both cookies, from this site's pages only", () => {
  const out = signOut(
    asking("/api/auth/signout?next=%2Fplayers", {}, { method: "POST", headers: { origin: SITE } }),
  );
  expect(out.status).toBe(303);
  expect(out.headers.get("location")).toBe("/players");
  expect(out.headers.getSetCookie().join()).toMatch(
    /ballest-session=;.*Max-Age=0.*ballest-in=;.*Max-Age=0/,
  );
  const post = (headers: Record<string, string>) =>
    signOut(asking("/api/auth/signout", {}, { method: "POST", headers })).status;
  expect(post({ origin: "https://evil.example" })).toBe(403);
  expect(post({ "sec-fetch-site": "cross-site" })).toBe(403);
});

test("every way back lands on a path on this site", async () => {
  expect((await signIn(ID, ENV, "//evil.example")).done.headers.get("location")).toBe("/");
  const out = signOut(
    asking("/api/auth/signout?next=https%3A%2F%2Fevil.example", {}, { method: "POST" }),
  );
  expect(out.headers.get("location")).toBe("/");
});
