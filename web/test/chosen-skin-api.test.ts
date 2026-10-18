// The Chosen Skin API (db/chosen-skin-api.ts) as the picker calls it, signed in or not, against
// a throwaway database: what it answers, and what every marble then reads (chosenSkins).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { chooseSkin, type ChosenSkinDeps } from "../db/chosen-skin-api";
import { chosenSkins } from "../db/site";
import { freshDb } from "./pg";
import { ENV, NOW, SITE, signIn } from "./session";

const ADA = "76561199000000021";
const BO = "76561199000000022";
const GOLD = "/Game/Art/M_GoldReal.M_GoldReal";
const MAGMA = "/Game/Art/Materials/Masters/M_LavaBall.M_LavaBall";
const MINUTE = 60_000;

let t: Awaited<ReturnType<typeof freshDb>>;
let changes: number;
let clock: number;
const deps = (): ChosenSkinDeps => ({
  db: t.db,
  auth: { ...ENV, now: clock },
  changed: () => changes++,
});

beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.drop());
beforeEach(async () => {
  changes = 0;
  clock = NOW;
  await t.db.$client.query("delete from chosen_skins; delete from chosen_skin_saves");
});

/* the session cookie of a browser signed in as `id` */
const cookieOf = async (id: string) => `ballest-session=${(await signIn(id)).session}`;

/* PUT (a pick) or DELETE (a clear) /api/me/skin as the picker sends it */
function sending(
  method: "PUT" | "DELETE",
  cookie: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(SITE + "/api/me/skin", {
    method,
    headers: { cookie, origin: SITE, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const pick = async (id: string, skin: unknown, headers?: Record<string, string>) =>
  chooseSkin(sending("PUT", await cookieOf(id), { skin }, headers), deps());

describe("saving a Chosen Skin", () => {
  test("a pick shows on every marble and expires the cached picks", async () => {
    const r = await pick(ADA, GOLD);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ skin: GOLD });
    expect(await chosenSkins(t.db)).toEqual({ [ADA]: GOLD });
    expect(changes).toBe(1);
  });

  test("a second pick replaces the first", async () => {
    await pick(ADA, GOLD);
    await pick(ADA, MAGMA);
    expect(await chosenSkins(t.db)).toEqual({ [ADA]: MAGMA });
  });

  test("clearing it puts the hue marble back, for that player only", async () => {
    await pick(ADA, GOLD);
    await pick(BO, MAGMA);
    const r = await chooseSkin(sending("DELETE", await cookieOf(ADA)), deps());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ skin: null });
    expect(await chosenSkins(t.db)).toEqual({ [BO]: MAGMA });
    expect(changes).toBe(3);
  });
});

describe("refusing a Chosen Skin", () => {
  test("signed out, nothing is saved", async () => {
    const r = await chooseSkin(sending("PUT", "", { skin: GOLD }), deps());
    expect(r.status).toBe(401);
    expect((await chooseSkin(sending("DELETE", ""), deps())).status).toBe(401);
    expect(await chosenSkins(t.db)).toEqual({});
    expect(changes).toBe(0);
  });

  test("from another site, nothing is saved or cleared", async () => {
    await pick(ADA, GOLD);
    const evil = { origin: "https://evil.example" };
    expect((await pick(ADA, MAGMA, evil)).status).toBe(403);
    const cookie = await cookieOf(ADA);
    expect((await chooseSkin(sending("DELETE", cookie, undefined, evil), deps())).status).toBe(403);
    expect(await chosenSkins(t.db)).toEqual({ [ADA]: GOLD });
    expect(changes).toBe(1);
  });

  test("a Skin the site has no picture for, or no Skin at all, is refused", async () => {
    for (const skin of ["/Game/Art/New/MI_NewSkin.MI_NewSkin", "DA_Skin_Pink", 7, null, ""])
      expect((await pick(ADA, skin)).status, String(skin)).toBe(400);
    const cookie = await cookieOf(ADA);
    const garbled = new Request(SITE + "/api/me/skin", {
      method: "PUT",
      headers: { cookie, origin: SITE },
      body: "{not json",
    });
    expect((await chooseSkin(garbled, deps())).status).toBe(400);
    expect(await chosenSkins(t.db)).toEqual({});
    expect(changes).toBe(0);
  });
});

describe("the hourly limit", () => {
  const clear = async (id: string) => chooseSkin(sending("DELETE", await cookieOf(id)), deps());

  test("ten saves in an hour, picks and clears alike; the eleventh is refused", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await pick(ADA, i % 2 ? GOLD : MAGMA)).status).toBe(200);
      clock += MINUTE;
      expect((await clear(ADA)).status).toBe(200);
      clock += MINUTE;
    }
    const r = await pick(ADA, GOLD);
    expect(r.status).toBe(429);
    expect((await clear(ADA)).status).toBe(429);
    expect(await chosenSkins(t.db)).toEqual({});
    expect(changes).toBe(10);
    /* another player has their own ten */
    expect((await pick(BO, GOLD)).status).toBe(200);
  });

  test("an hour after a save, it frees up again", async () => {
    for (let i = 0; i < 10; i++) {
      await pick(ADA, i % 2 ? GOLD : MAGMA);
      clock += MINUTE;
    }
    expect((await pick(ADA, GOLD)).status).toBe(429);
    /* the first save was at NOW: an hour on, only that one has dropped out */
    clock = NOW + 60 * MINUTE + 1;
    expect((await pick(ADA, GOLD)).status).toBe(200);
    expect((await pick(ADA, MAGMA)).status).toBe(429);
    expect(await chosenSkins(t.db)).toEqual({ [ADA]: GOLD });
  });

  test("a refused request doesn't count against it", async () => {
    for (let i = 0; i < 12; i++) await pick(ADA, "/Game/Art/New/MI_NewSkin.MI_NewSkin");
    expect((await pick(ADA, GOLD)).status).toBe(200);
  });
});
