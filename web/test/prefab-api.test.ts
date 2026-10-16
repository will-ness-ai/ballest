// The Prefab API routes (db/prefab-api.ts) as a browser calls them, signed in or not, against
// a throwaway database: what each answers, and what the gallery and pages then read.
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { favoritePrefab, uploadPrefab, uploadQuota, type PrefabDeps } from "../db/prefab-api";
import { galleryOf } from "../lib/prefabs";
import { prefabList, prefabOf } from "../db/prefabs";
import { prefabBans } from "../db/schema";
import { cubesFile } from "../db/seed/datasets/tiny";
import { freshDb } from "./pg";
import { ENV, NOW, SITE, signIn } from "./session";

const UPLOADER = "76561199000000011";
const HOUR = 3_600_000;
const bench = readFileSync(new URL("../../prefabs/samples/bench.json", import.meta.url), "utf8");

let t: Awaited<ReturnType<typeof freshDb>>;
let pings: Array<string>;
let changes: number;
let clock: number;
const deps = (): PrefabDeps => ({
  db: t.db,
  auth: { ...ENV, now: clock },
  ping: (text) => {
    pings.push(text);
    return Promise.resolve();
  },
  persona: () => Promise.resolve("Uploader on Steam"),
  changed: () => changes++,
});

beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.drop());
beforeEach(() => {
  pings = [];
  changes = 0;
  clock = NOW;
});

/* the session cookie of a browser signed in as `id` */
const sessionOf = async (id: string) => `ballest-session=${(await signIn(id)).session}`;

/* POST /api/prefabs as the upload form sends it */
function uploading(
  fields: { name?: string; description?: string; tags?: Array<string>; file?: string },
  cookie = "",
  headers: Record<string, string> = {},
) {
  const body = new FormData();
  body.set("name", fields.name ?? "Park bench");
  body.set("description", fields.description ?? "");
  for (const tag of fields.tags ?? []) body.append("tags", tag);
  body.set("file", new Blob([fields.file ?? bench]), "bench.json");
  return new Request(SITE + "/api/prefabs", {
    method: "POST",
    body,
    headers: { cookie, origin: SITE, ...headers },
  });
}

describe("uploading a Prefab", () => {
  test("signed out, nothing is saved", async () => {
    const r = await uploadPrefab(uploading({}), deps());
    expect(r.status).toBe(401);
    expect(await prefabList(t.db)).toEqual([]);
  });

  test("from another site, nothing is saved", async () => {
    const cookie = await sessionOf(UPLOADER);
    const r = await uploadPrefab(uploading({}, cookie, { origin: "https://evil.example" }), deps());
    expect(r.status).toBe(403);
    expect(await prefabList(t.db)).toEqual([]);
  });

  test("a file the game wouldn't spawn is refused with every reason", async () => {
    const cookie = await sessionOf(UPLOADER);
    const r = await uploadPrefab(uploading({ file: '{"format":"BallestMap"}' }, cookie), deps());
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      problems: [
        'It isn\'t a prefab: "format" should be "BallestPrefab".',
        "Its group transform is missing.",
        "It has no pieces.",
      ],
    });
  });

  test("a name, description or tag out of bounds is refused", async () => {
    const cookie = await sessionOf(UPLOADER);
    const bad = async (fields: Parameters<typeof uploading>[0]) =>
      (
        (await (await uploadPrefab(uploading(fields, cookie), deps())).json()) as {
          problems: Array<string>;
        }
      ).problems;
    expect(await bad({ name: "   " })).toEqual(["Give it a name."]);
    expect(await bad({ name: "x".repeat(65) })).toEqual(["Keep the name to 64 characters."]);
    expect(await bad({ description: "x".repeat(501) })).toEqual([
      "Keep the description to 500 characters.",
    ]);
    expect(await bad({ tags: ["Ramp", "Loop", "Scenery", "Obstacle"] })).toEqual([
      "Pick up to 3 tags.",
    ]);
    expect(await bad({ tags: ["Spaceship"] })).toEqual(["Spaceship isn't one of the tags."]);
    expect(await prefabList(t.db)).toEqual([]);
  });

  test("a good one is live at once, credited to the uploader, and pinged to ops", async () => {
    const cookie = await sessionOf(UPLOADER);
    const r = await uploadPrefab(
      uploading({ name: " Park bench ", description: "Sit.", tags: ["Decoration"] }, cookie),
      deps(),
    );
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ slug: "park-bench" });
    expect(await prefabOf(t.db, "park-bench")).toMatchObject({
      name: "Park bench",
      description: "Sit.",
      tags: ["Decoration"],
      uploader: { steamId: UPLOADER, name: "Uploader on Steam", isPlayer: false },
      pieces: 28,
      file: bench,
    });
    expect(changes).toBe(1);
    expect(pings).toEqual([
      "New prefab: **Park bench** (28 pieces) by Uploader on Steam\nhttps://ballestrecords.com/prefab/park-bench",
    ]);
  });

  test("a sixth in 24 hours waits until the oldest is a day old", async () => {
    const id = "76561199000000012";
    const cookie = await sessionOf(id);
    const quota = async (): Promise<unknown> =>
      (await uploadQuota(uploading({}, cookie), deps())).json();
    expect(await quota()).toEqual({ signedIn: true, banned: false, left: 5, nextAt: null });
    for (let i = 0; i < 5; i++) {
      clock = NOW + i * HOUR;
      expect(
        (
          await uploadPrefab(
            uploading({ name: `Cubes ${String(i)}`, file: cubesFile(2) }, cookie),
            deps(),
          )
        ).status,
      ).toBe(201);
    }
    clock = NOW + 6 * HOUR;
    expect(await quota()).toEqual({
      signedIn: true,
      banned: false,
      left: 0,
      nextAt: new Date(NOW + 24 * HOUR).toISOString(),
    });
    const refused = await uploadPrefab(uploading({ name: "One more" }, cookie), deps());
    expect(refused.status).toBe(429);
    clock = NOW + 24 * HOUR + 1000;
    expect(await quota()).toMatchObject({ left: 1 });
    expect((await uploadPrefab(uploading({ name: "One more" }, cookie), deps())).status).toBe(201);
  });

  test("a banned player can't upload, and the form says so", async () => {
    const id = "76561199000000013";
    await t.db.insert(prefabBans).values({ steamId: id, bannedBy: "76561198047685844" });
    const cookie = await sessionOf(id);
    expect(await (await uploadQuota(uploading({}, cookie), deps())).json()).toMatchObject({
      banned: true,
      left: 0,
    });
    expect((await uploadPrefab(uploading({ name: "Sneaky" }, cookie), deps())).status).toBe(403);
  });

  test("signed out, the quota says so", async () => {
    expect(await (await uploadQuota(uploading({}), deps())).json()).toEqual({
      signedIn: false,
      banned: false,
      left: 0,
      nextAt: null,
    });
  });
});

describe("favorites", () => {
  /* a request to /api/prefabs/<slug>/favorite */
  const fav = (slug: string, method: string, cookie = "") =>
    new Request(`${SITE}/api/prefabs/${slug}/favorite`, {
      method,
      headers: { cookie, origin: SITE },
    });
  const said = async (r: Response) => ({ status: r.status, body: (await r.json()) as unknown });

  test("a signed-in player hearts a Prefab once, and can take it back", async () => {
    const owner = await sessionOf("76561199000000021");
    await uploadPrefab(uploading({ name: "Heart me" }, owner), deps());
    changes = 0;
    const a = await sessionOf("76561199000000022");
    const b = await sessionOf("76561199000000023");
    expect(await said(await favoritePrefab(fav("heart-me", "GET", a), deps(), "heart-me"))).toEqual(
      {
        status: 200,
        body: { on: false, favorites: 0 },
      },
    );
    expect(await said(await favoritePrefab(fav("heart-me", "PUT", a), deps(), "heart-me"))).toEqual(
      {
        status: 200,
        body: { on: true, favorites: 1 },
      },
    );
    // twice is still once
    await favoritePrefab(fav("heart-me", "PUT", a), deps(), "heart-me");
    expect(await said(await favoritePrefab(fav("heart-me", "PUT", b), deps(), "heart-me"))).toEqual(
      {
        status: 200,
        body: { on: true, favorites: 2 },
      },
    );
    expect((await prefabOf(t.db, "heart-me"))?.favorites).toBe(2);
    expect(
      await said(await favoritePrefab(fav("heart-me", "DELETE", a), deps(), "heart-me")),
    ).toEqual({
      status: 200,
      body: { on: false, favorites: 1 },
    });
    expect(changes).toBe(4);
  });

  test("signed out it only counts, and asks to sign in to change", async () => {
    expect(await said(await favoritePrefab(fav("heart-me", "GET"), deps(), "heart-me"))).toEqual({
      status: 200,
      body: { on: false, favorites: 1 },
    });
    expect((await favoritePrefab(fav("heart-me", "PUT"), deps(), "heart-me")).status).toBe(401);
  });

  test("a Prefab nobody uploaded can't be hearted", async () => {
    const a = await sessionOf("76561199000000022");
    expect((await favoritePrefab(fav("nope", "PUT", a), deps(), "nope")).status).toBe(404);
  });

  test("the gallery puts the most hearted first", async () => {
    const cards = galleryOf(await prefabList(t.db), "popular", null);
    expect(cards[0].slug).toBe("heart-me");
  });
});
