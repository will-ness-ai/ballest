// Signing in from a desktop app through the browser (lib/auth.ts startAppSignIn,
// finishAppSignIn, signInFromApp; ADR 0017): the app opens our Steam login with a loopback
// callback and a PKCE challenge, the browser comes back to the app with a code, and the app
// trades the code and its secret for an app token the Prefab API takes.
import { createHash } from "node:crypto";

import { expect, test } from "vitest";

import {
  APP_SESSION_SECONDS,
  finishAppSignIn,
  prefabSessionOf,
  sessionOf,
  signInFromApp,
  startAppSignIn,
  type AuthEnv,
} from "../lib/auth";
import {
  ENV,
  ID,
  NOW,
  SITE,
  asking,
  setCookies,
  steamReturns,
  steamSays,
  valueOf,
} from "./session";

/* the app's secret, and the challenge it sends: SHA-256 of the secret, base64url */
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const CALLBACK = "http://127.0.0.1:51234/callback";

const startUrl = (params: Record<string, string>) =>
  "/api/auth/app?" + new URLSearchParams(params).toString();
const STARTED = { redirect_uri: CALLBACK, state: "abc123", code_challenge: CHALLENGE };

/* the browser's round trip: start, Steam's login as `id`, and back to the app's callback */
async function browserTrip(params = STARTED, env: AuthEnv = ENV, id = ID) {
  const started = startAppSignIn(asking(startUrl(params)));
  const state = valueOf(setCookies(started)["ballest-signin"]);
  const back = await finishAppSignIn(
    asking(steamReturns(started, id), { "ballest-signin": state }),
    env,
  );
  return { started, back, to: new URL(back.headers.get("location") ?? "") };
}

/* POST /api/auth/app/token as the app's main process sends it: no cookie, no Origin */
const tradeIn = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(SITE + "/api/auth/app/token", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const withBearer = (token: string) =>
  new Request(SITE + "/api/prefabs", { headers: { authorization: `Bearer ${token}` } });

test("a login Steam confirms comes back to the app with a code it trades for an app token", async () => {
  const { back, to } = await browserTrip();
  expect(back.status).toBe(303);
  expect(to.origin + to.pathname).toBe(CALLBACK);
  expect(to.searchParams.get("state")).toBe("abc123");
  const code = to.searchParams.get("code") ?? "";
  expect(code).not.toBe("");
  // the browser isn't signed in to the site by it
  expect(Object.keys(setCookies(back))).toEqual(["ballest-signin"]);

  const r = await signInFromApp(tradeIn({ code, code_verifier: VERIFIER }), ENV);
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(r.headers.getSetCookie()).toEqual([]);
  const { id, token, expiresIn } = (await r.json()) as {
    id: string;
    token: string;
    expiresIn: number;
  };
  expect(id).toBe(ID);
  expect(expiresIn).toBe(30 * 86_400);
  expect(APP_SESSION_SECONDS).toBe(30 * 86_400);
  expect(prefabSessionOf(withBearer(token), ENV)).toBe(ID);
  expect(sessionOf(withBearer(token), ENV)).toBeNull();
});

test("only a plain http callback on the loopback address is taken, and nothing else is ever redirected to", () => {
  const bad = [
    "https://127.0.0.1:51234/callback",
    "http://localhost:51234/callback",
    "http://evil.example/callback",
    "http://127.0.0.1.evil.example/callback",
    "http://user:pw@127.0.0.1:51234/callback",
    "http://127.0.0.1:51234/callback#frag",
    "ballest://callback",
    "",
  ];
  for (const redirect_uri of bad) {
    const r = startAppSignIn(asking(startUrl({ ...STARTED, redirect_uri })));
    expect(r.status, redirect_uri).toBe(400);
    expect(r.headers.get("location")).toBeNull();
  }
  for (const redirect_uri of ["http://127.0.0.1/", "http://[::1]:8080/cb?x=1"])
    expect(startAppSignIn(asking(startUrl({ ...STARTED, redirect_uri }))).status).toBe(302);
});

test("a state or challenge that doesn't check, or a method other than S256, is refused", () => {
  const bad: Array<Record<string, string>> = [
    { ...STARTED, state: "" },
    { ...STARTED, state: "has space" },
    { ...STARTED, state: "x".repeat(201) },
    { ...STARTED, code_challenge: "short" },
    { ...STARTED, code_challenge: VERIFIER + "=" },
    { ...STARTED, code_challenge_method: "plain" },
    { redirect_uri: CALLBACK, state: "abc123" },
  ];
  for (const params of bad) expect(startAppSignIn(asking(startUrl(params))).status).toBe(400);
  expect(
    startAppSignIn(asking(startUrl({ ...STARTED, code_challenge_method: "S256" }))).status,
  ).toBe(302);
});

test("a login Steam doesn't confirm, or another browser's, comes back to the app as access_denied", async () => {
  const refused = await browserTrip(STARTED, { ...ENV, steam: steamSays("is_valid:false\n") });
  expect(refused.back.status).toBe(303);
  expect(refused.to.origin + refused.to.pathname).toBe(CALLBACK);
  expect(Object.fromEntries(refused.to.searchParams)).toEqual({
    error: "access_denied",
    state: "abc123",
  });

  const started = startAppSignIn(asking(startUrl(STARTED)));
  const other = await finishAppSignIn(
    asking(steamReturns(started), { "ballest-signin": "another-browser" }),
    ENV,
  );
  expect(new URL(other.headers.get("location") ?? "").searchParams.get("error")).toBe(
    "access_denied",
  );
});

test("a return whose app request Steam didn't sign never redirects", async () => {
  const started = startAppSignIn(asking(startUrl(STARTED)));
  const state = valueOf(setCookies(started)["ballest-signin"]);
  // the callback swapped beside Steam's signed return address
  const swapped = new URL(SITE + steamReturns(started));
  swapped.searchParams.set("redirect_uri", "http://127.0.0.1:9/elsewhere");
  const r = await finishAppSignIn(
    asking(swapped.pathname + swapped.search, { "ballest-signin": state }),
    ENV,
  );
  expect(new URL(r.headers.get("location") ?? "").searchParams.get("error")).toBe("access_denied");
  expect(new URL(r.headers.get("location") ?? "").port).toBe("51234");
  // a return with no app request at all
  const none = await finishAppSignIn(asking("/api/auth/app/return?x=1"), ENV);
  expect(none.status).toBe(400);
  expect(none.headers.get("location")).toBeNull();
});

/* a code the browser brought back to the app */
async function codeOf(env: AuthEnv = ENV) {
  return (await browserTrip(STARTED, env)).to.searchParams.get("code") ?? "";
}

test("a code is worth nothing without the app's secret, altered, or after two minutes", async () => {
  const code = await codeOf();
  const trade = (body: unknown, env: AuthEnv = ENV) => signInFromApp(tradeIn(body), env);
  const wrong = "x".repeat(43);
  for (const body of [
    { code, code_verifier: wrong },
    { code },
    { code: code.replace(/^7/, "8"), code_verifier: VERIFIER },
    { code: code.slice(0, -2) + "AA", code_verifier: VERIFIER },
    { code: "", code_verifier: VERIFIER },
  ]) {
    const r = await trade(body);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_grant" });
  }
  expect((await trade("not json")).status).toBe(400);
  expect(
    (await trade({ code, code_verifier: VERIFIER }, { ...ENV, now: NOW + 119_000 })).status,
  ).toBe(200);
  expect(
    (await trade({ code, code_verifier: VERIFIER }, { ...ENV, now: NOW + 121_000 })).status,
  ).toBe(400);
  // and not under another secret
  expect((await trade({ code, code_verifier: VERIFIER }, { ...ENV, secret: "other" })).status).toBe(
    400,
  );
});

test("the trade counts against the sign-in limit, and is refused from another site or with no secret", async () => {
  const code = await codeOf();
  const good = { code, code_verifier: VERIFIER };
  const limited = await signInFromApp(tradeIn(good), {
    ...ENV,
    allowGameSignIn: () => Promise.resolve(false),
  });
  expect(limited.status).toBe(429);
  const asked: Array<Request> = [];
  const counted = await signInFromApp(tradeIn(good), {
    ...ENV,
    allowGameSignIn: (r) => (asked.push(r), Promise.resolve(true)),
  });
  expect(counted.status).toBe(200);
  expect(asked).toHaveLength(1);
  expect((await signInFromApp(tradeIn(good, { origin: "https://evil.example" }), ENV)).status).toBe(
    403,
  );
  expect((await signInFromApp(tradeIn(good), { ...ENV, secret: "" })).status).toBe(503);
});

test("an app token lasts 30 days on the Prefab API and never passes as the game's or the browser's", async () => {
  const code = await codeOf();
  const r = await signInFromApp(tradeIn({ code, code_verifier: VERIFIER }), ENV);
  const { token } = (await r.json()) as { token: string };
  const at = (now: number) => prefabSessionOf(withBearer(token), { ...ENV, now });
  expect(at(NOW + 29 * 86_400_000)).toBe(ID);
  expect(at(NOW + 31 * 86_400_000)).toBeNull();
  // the game's token would have run out after a day; an app's kind is its own
  expect(token.split(".")[2]).toBe("app");
  expect(prefabSessionOf(withBearer(token.replace(".app.", ".game.")), ENV)).toBeNull();
  expect(
    sessionOf(new Request(SITE, { headers: { cookie: `ballest-session=${token}` } }), ENV),
  ).toBeNull();
  // nor is a code a token
  expect(prefabSessionOf(withBearer(code), ENV)).toBeNull();
});
