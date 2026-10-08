import { expect, test } from "vitest";

import { STEAM_LOGIN, loginUrl, safeNext, verifyReturn } from "../lib/steam-openid";

const ORIGIN = "https://ballestrecords.com";
const ID = "76561198008697957";

/* what Steam sends back for a login of `id`, coming back to `next` */
function returned(id = ID, over: Record<string, string> = {}) {
  const back = `${ORIGIN}/api/auth/steam/return?next=%2Fmaps`;
  const url = new URL(back);
  const claimed = `https://steamcommunity.com/openid/id/${id}`;
  const p = {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_LOGIN,
    "openid.claimed_id": claimed,
    "openid.identity": claimed,
    "openid.return_to": back,
    "openid.response_nonce": "2026-10-08T00:00:00Zabc",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2ln",
    ...over,
  };
  for (const [k, v] of Object.entries(p)) url.searchParams.set(k, v);
  return url;
}

/* a stand-in for Steam's check_authentication, recording what it was asked */
function steam(answer: string, status = 200) {
  const asked: Array<URLSearchParams> = [];
  const check = ((to: string, init: RequestInit) => {
    expect(to).toBe(STEAM_LOGIN);
    asked.push(new URLSearchParams(init.body as URLSearchParams));
    return Promise.resolve(new Response(answer, { status }));
  }) as typeof fetch;
  return { check, asked };
}

test("the login page asks Steam to pick the identity and come back here", () => {
  const u = new URL(loginUrl(ORIGIN, "/board/Map_Track13"));
  expect(u.origin + u.pathname).toBe(STEAM_LOGIN);
  expect(u.searchParams.get("openid.mode")).toBe("checkid_setup");
  expect(u.searchParams.get("openid.realm")).toBe(ORIGIN + "/");
  const back = new URL(u.searchParams.get("openid.return_to") ?? "");
  expect(back.origin + back.pathname).toBe(ORIGIN + "/api/auth/steam/return");
  expect(back.searchParams.get("next")).toBe("/board/Map_Track13");
});

test("a login Steam confirms gives its Steam ID, checked with every openid field", async () => {
  const { check, asked } = steam("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n");
  expect(await verifyReturn(returned(), check)).toBe(ID);
  expect(asked[0].get("openid.mode")).toBe("check_authentication");
  expect(asked[0].get("openid.sig")).toBe("c2ln");
  expect(asked[0].has("next")).toBe(false);
});

test("a login Steam doesn't confirm, or can't be asked about, gives nobody", async () => {
  expect(await verifyReturn(returned(), steam("is_valid:false\n").check)).toBeNull();
  expect(await verifyReturn(returned(), steam("is_valid:true", 500).check)).toBeNull();
  const down = (() => Promise.reject(new Error("down"))) as typeof fetch;
  expect(await verifyReturn(returned(), down)).toBeNull();
});

test("an assertion for another site, endpoint or identity is refused before Steam is asked", async () => {
  const { check, asked } = steam("is_valid:true\n");
  const bad = [
    returned(ID, { "openid.mode": "cancel" }),
    returned(ID, { "openid.op_endpoint": "https://evil.example/openid/login" }),
    returned(ID, { "openid.return_to": "https://evil.example/api/auth/steam/return" }),
    returned(ID, { "openid.return_to": ORIGIN + "/elsewhere" }),
    returned(ID, { "openid.claimed_id": "https://evil.example/openid/id/" + ID }),
    returned(ID, { "openid.identity": "https://steamcommunity.com/openid/id/76561198000000000" }),
    returned("abc"),
  ];
  for (const u of bad) expect(await verifyReturn(u, check)).toBeNull();
  expect(asked).toHaveLength(0);
});

test("only a path on this site is somewhere to come back to", () => {
  expect(safeNext("/maps")).toBe("/maps");
  expect(safeNext("/board/Map_Track13?x=1")).toBe("/board/Map_Track13?x=1");
  for (const bad of [
    null,
    "",
    "maps",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "/a b",
  ])
    expect(safeNext(bad)).toBe("/");
});
