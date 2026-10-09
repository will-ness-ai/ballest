// Sign in with Steam through lib/auth.ts's four calls, as the routes make them, with a
// stand-in for Steam's check_authentication.
import { expect, test } from "vitest";

import { finishSignIn, signOut, startSignIn, whoIs, type AuthEnv } from "../lib/auth";

const SITE = "https://ballestrecords.com";
const ID = "76561198008697957";
const NOW = Date.parse("2026-10-08T12:00:30Z");
const DAY = 86_400_000;
const ENV: AuthEnv = { secret: "s3cret", now: NOW, steam: steamSays("is_valid:true\n") };

function steamSays(answer: string): typeof fetch {
  return () => Promise.resolve(new Response(answer));
}

/* the Set-Cookie headers of a response, by name */
function setCookies(r: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of r.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    out[pair.slice(0, eq)] = c;
  }
  return out;
}
const valueOf = (c: string | undefined) => c?.split(";")[0].split("=").slice(1).join("=") ?? "";

/* a browser's request with `cookies` */
const asking = (path: string, cookies: Record<string, string> = {}, init: RequestInit = {}) =>
  new Request(SITE + path, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
  });

/* start a sign-in from `next`, and come back from Steam having logged in as `id` */
async function signIn(id = ID, env: AuthEnv = ENV, next = "/board/Map_Track13") {
  const started = startSignIn(asking("/api/auth/steam?next=" + encodeURIComponent(next)));
  const state = valueOf(setCookies(started)["ballest-signin"]);
  const login = new URL(started.headers.get("location") ?? "");
  const back = new URL(login.searchParams.get("openid.return_to") ?? "");
  const claimed = "https://steamcommunity.com/openid/id/" + id;
  for (const [k, v] of Object.entries({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": claimed,
    "openid.identity": claimed,
    "openid.return_to": back.toString(),
    "openid.response_nonce": "2026-10-08T12:00:00Zabc",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2ln",
  }))
    back.searchParams.set(k, v);
  const returned = back.pathname + back.search;
  const done = await finishSignIn(asking(returned, { "ballest-signin": state }), env);
  return { started, state, returned, done, session: valueOf(setCookies(done)["ballest-session"]) };
}

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
