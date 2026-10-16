// The Prefab API routes (db/prefab-api.ts) as a browser calls them, signed in or not, against
// a throwaway database: what each answers, and what the gallery and pages then read.
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
  banUploader,
  editPrefab,
  favoritePrefab,
  takeDownPrefab,
  uploadPrefab,
  limitUploader,
  uploadQuota,
  type PrefabDeps,
} from "../db/prefab-api";
import { pingOf, type PrefabPing } from "../db/prefab-ping";
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
let pings: Array<PrefabPing>;
let changes: number;
let clock: number;
const deps = (): PrefabDeps => ({
  db: t.db,
  auth: { ...ENV, now: clock },
  ping: (p) => {
    pings.push(p);
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
  fields: {
    name?: string;
    description?: string;
    tags?: Array<string>;
    file?: string;
    picture?: Uint8Array<ArrayBuffer>;
  },
  cookie = "",
  headers: Record<string, string> = {},
) {
  const body = new FormData();
  body.set("name", fields.name ?? "Park bench");
  body.set("description", fields.description ?? "");
  for (const tag of fields.tags ?? []) body.append("tags", tag);
  body.set("file", new Blob([fields.file ?? bench]), "bench.json");
  if (fields.picture) body.set("picture", new Blob([fields.picture]), "prefab.png");
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

  test("a good one is live at once, credited to the uploader, and pinged", async () => {
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
      {
        slug: "park-bench",
        name: "Park bench",
        pieces: 28,
        tags: ["Decoration"],
        uploader: { steamId: UPLOADER, name: "Uploader on Steam" },
        picture: null,
      },
    ]);
  });

  test("the preview still the browser sends rides along with the ping, if it is a PNG", async () => {
    const cookie = await sessionOf("76561199000000013");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await uploadPrefab(uploading({ name: "Pictured", picture: png }, cookie), deps());
    await uploadPrefab(
      uploading({ name: "Not a picture", picture: new TextEncoder().encode("<svg/>") }, cookie),
      deps(),
    );
    const big = new Uint8Array(1_000_001);
    big.set(png);
    await uploadPrefab(uploading({ name: "Too big", picture: big }, cookie), deps());
    expect(pings.map((p) => [p.name, p.picture])).toEqual([
      ["Pictured", png],
      ["Not a picture", null],
      ["Too big", null],
    ]);
  });

  test("a sixth in 24 hours waits until the oldest is a day old", async () => {
    const id = "76561199000000012";
    const cookie = await sessionOf(id);
    const quota = async (): Promise<unknown> =>
      (await uploadQuota(uploading({}, cookie), deps())).json();
    expect(await quota()).toEqual({
      signedIn: true,
      banned: false,
      left: 5,
      limit: 5,
      nextAt: null,
    });
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
      limit: 5,
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
      limit: 0,
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

describe("editing and deleting your own", () => {
  const OWNER = "76561199000000031";
  /* PATCH or DELETE /api/prefabs/<slug> */
  const change = (slug: string, method: string, cookie: string, body?: object) =>
    new Request(`${SITE}/api/prefabs/${slug}`, {
      method,
      headers: { cookie, origin: SITE, "content-type": "application/json" },
      body: body && JSON.stringify(body),
    });

  test("the uploader renames, redescribes and retags it, and its link stays", async () => {
    const owner = await sessionOf(OWNER);
    await uploadPrefab(uploading({ name: "Mine to edit", tags: ["Ramp"] }, owner), deps());
    changes = 0;
    const r = await editPrefab(
      change("mine-to-edit", "PATCH", owner, {
        name: "Edited",
        description: "Now described.",
        tags: ["Loop", "Scenery"],
      }),
      deps(),
      "mine-to-edit",
    );
    expect(r.status).toBe(200);
    expect(await prefabOf(t.db, "mine-to-edit")).toMatchObject({
      slug: "mine-to-edit",
      name: "Edited",
      description: "Now described.",
      tags: ["Loop", "Scenery"],
      state: "live",
    });
    expect(changes).toBe(1);
  });

  test("fields out of bounds are refused as on upload", async () => {
    const owner = await sessionOf(OWNER);
    const r = await editPrefab(
      change("mine-to-edit", "PATCH", owner, { name: "", description: "", tags: [] }),
      deps(),
      "mine-to-edit",
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ problems: ["Give it a name."] });
  });

  test("nobody else can edit or delete it, signed in or not", async () => {
    const other = await sessionOf("76561199000000032");
    const edit = { name: "Mine now", description: "", tags: [] };
    expect(
      (await editPrefab(change("mine-to-edit", "PATCH", other, edit), deps(), "mine-to-edit"))
        .status,
    ).toBe(403);
    expect(
      (await editPrefab(change("mine-to-edit", "PATCH", "", edit), deps(), "mine-to-edit")).status,
    ).toBe(401);
    expect(
      (await editPrefab(change("mine-to-edit", "DELETE", other), deps(), "mine-to-edit")).status,
    ).toBe(403);
    expect((await prefabOf(t.db, "mine-to-edit"))?.name).toBe("Edited");
  });

  test("deleting it takes it out of the gallery, its page reads gone, and it still counts", async () => {
    const owner = await sessionOf(OWNER);
    const before = (await (await uploadQuota(uploading({}, owner), deps())).json()) as {
      left: number;
    };
    expect(
      (await editPrefab(change("mine-to-edit", "DELETE", owner), deps(), "mine-to-edit")).status,
    ).toBe(200);
    expect((await prefabOf(t.db, "mine-to-edit"))?.state).toBe("deleted");
    expect((await prefabList(t.db)).map((c) => c.slug)).not.toContain("mine-to-edit");
    expect(await (await uploadQuota(uploading({}, owner), deps())).json()).toMatchObject({
      left: before.left,
    });
    // and once deleted it can't be edited or deleted again
    expect(
      (await editPrefab(change("mine-to-edit", "DELETE", owner), deps(), "mine-to-edit")).status,
    ).toBe(404);
  });
});

describe("the admin's take down and ban", () => {
  const ADMIN = "76561198047685844";
  const BAD = "76561199000000041";
  const post = (path: string, method: string, cookie: string) =>
    new Request(SITE + path, { method, headers: { cookie, origin: SITE } });
  const states = async () =>
    Object.fromEntries(
      await Promise.all(
        ["bad-one", "bad-two"].map(async (s) => [s, (await prefabOf(t.db, s))?.state]),
      ),
    ) as Record<string, string>;

  test("only the admin can take a Prefab down, and it reads gone", async () => {
    const bad = await sessionOf(BAD);
    await uploadPrefab(uploading({ name: "Bad one" }, bad), deps());
    await uploadPrefab(uploading({ name: "Bad two" }, bad), deps());
    const other = await sessionOf("76561199000000042");
    expect(
      (
        await takeDownPrefab(
          post("/api/prefabs/bad-one/takedown", "POST", other),
          deps(),
          "bad-one",
        )
      ).status,
    ).toBe(403);
    expect(
      (await takeDownPrefab(post("/api/prefabs/bad-one/takedown", "POST", bad), deps(), "bad-one"))
        .status,
    ).toBe(403);
    changes = 0;
    const admin = await sessionOf(ADMIN);
    expect(
      (
        await takeDownPrefab(
          post("/api/prefabs/bad-one/takedown", "POST", admin),
          deps(),
          "bad-one",
        )
      ).status,
    ).toBe(200);
    expect(await states()).toEqual({ "bad-one": "taken-down", "bad-two": "live" });
    expect((await prefabList(t.db)).map((c) => c.slug)).not.toContain("bad-one");
    expect(changes).toBe(1);
  });

  test("a ban stops the player uploading and hides their Prefabs; an unban brings them back", async () => {
    const admin = await sessionOf(ADMIN);
    const bad = await sessionOf(BAD);
    const other = await sessionOf("76561199000000042");
    expect(
      (await banUploader(post(`/api/prefab-bans/${BAD}`, "PUT", other), deps(), BAD)).status,
    ).toBe(403);
    expect(
      (await banUploader(post(`/api/prefab-bans/${BAD}`, "PUT", admin), deps(), BAD)).status,
    ).toBe(200);
    expect(await states()).toEqual({ "bad-one": "taken-down", "bad-two": "hidden" });
    expect((await prefabList(t.db)).map((c) => c.slug)).not.toContain("bad-two");
    expect((await uploadPrefab(uploading({ name: "Bad three" }, bad), deps())).status).toBe(403);
    expect(
      (await banUploader(post(`/api/prefab-bans/${BAD}`, "DELETE", admin), deps(), BAD)).status,
    ).toBe(200);
    expect(await states()).toEqual({ "bad-one": "taken-down", "bad-two": "live" });
    expect((await prefabList(t.db)).map((c) => c.slug)).toContain("bad-two");
  });

  test("the admin gives a player their own daily limit, and can put them back on the default", async () => {
    const id = "76561199000000043";
    const url = `/api/prefab-limits/${id}`;
    const admin = await sessionOf(ADMIN);
    const them = await sessionOf(id);
    const set = (daily: unknown, cookie = admin) =>
      limitUploader(
        new Request(SITE + url, {
          method: "PUT",
          body: JSON.stringify({ daily }),
          headers: { cookie, origin: SITE, "content-type": "application/json" },
        }),
        deps(),
        id,
      );
    const left = async () =>
      ((await (await uploadQuota(uploading({}, them), deps())).json()) as { left: number }).left;
    expect(await (await limitUploader(post(url, "GET", admin), deps(), id)).json()).toEqual({
      steamId: id,
      daily: 5,
      own: false,
    });
    expect((await set(25, them)).status).toBe(403);
    for (const bad of [0, 2.5, "25", 1001]) expect((await set(bad)).status).toBe(400);
    expect(await (await set(25)).json()).toEqual({ steamId: id, daily: 25, own: true });
    for (let i = 0; i < 6; i++)
      await uploadPrefab(
        uploading({ name: `Sign ${String(i)}`, file: cubesFile(2) }, them),
        deps(),
      );
    expect(await left()).toBe(19);
    expect(await (await set(6)).json()).toMatchObject({ daily: 6 });
    expect(await left()).toBe(0);
    const refused = await uploadPrefab(uploading({ name: "Sign 7" }, them), deps());
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      limit: 6,
      nextAt: new Date(NOW + 24 * HOUR).toISOString(),
    });
    expect(await (await limitUploader(post(url, "DELETE", admin), deps(), id)).json()).toEqual({
      steamId: id,
      daily: 5,
      own: false,
    });
    expect(await left()).toBe(0);
  });

  test("the admin can't ban themselves", async () => {
    const admin = await sessionOf(ADMIN);
    expect(
      (await banUploader(post(`/api/prefab-bans/${ADMIN}`, "PUT", admin), deps(), ADMIN)).status,
    ).toBe(400);
  });
});

describe("the ping to the Prefabs channel", () => {
  const ping: PrefabPing = {
    slug: "park-bench",
    name: "Park bench",
    pieces: 28,
    tags: ["Decoration", "Scenery"],
    uploader: { steamId: UPLOADER, name: "Uploader on Steam" },
    picture: new Uint8Array([0x89, 0x50]),
  };

  test("shows the picture and links the page, the take-down and the ban", () => {
    const { embeds, components } = pingOf(ping);
    expect(embeds).toEqual([
      {
        title: "Park bench",
        url: "https://ballestrecords.com/prefab/park-bench",
        description: "by Uploader on Steam · 28 pieces · Decoration, Scenery",
        image: { url: "attachment://prefab.png" },
      },
    ]);
    expect(components[0].components.map((b) => [b.label, b.url])).toEqual([
      ["Open", "https://ballestrecords.com/prefab/park-bench"],
      ["Take down", "https://ballestrecords.com/prefab/park-bench?admin=take-down"],
      ["Ban uploader", "https://ballestrecords.com/prefab/park-bench?admin=ban"],
    ]);
  });

  test("without a picture, the embed has none", () => {
    expect(pingOf({ ...ping, picture: null }).embeds[0]).not.toHaveProperty("image");
  });
});
