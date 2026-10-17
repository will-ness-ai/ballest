// Prefabs in the database (db/prefabs.ts): what a Prefab's page and the gallery read.
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { players } from "../db/schema";
import { addPrefab, prefabList, prefabOf } from "../db/prefabs";
import { freshDb } from "./pg";

const WILL = "76561198047685844";
const NEWCOMER = "76561199000000099";
const bench = readFileSync(new URL("../../prefabs/samples/bench.json", import.meta.url), "utf8");

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await t.db.insert(players).values({ steamId: WILL, persona: "Will" });
});
afterAll(() => t.drop());

describe("a Prefab's page", () => {
  test("reads back what was uploaded, with its uploader's persona from the boards", async () => {
    const { slug } = await addPrefab(t.db, {
      name: "Park bench",
      description: "Somewhere to sit.",
      tags: ["Decoration"],
      uploader: WILL,
      uploaderName: "Will (Steam)",
      file: bench,
    });
    expect(slug).toBe("park-bench");
    const p = await prefabOf(t.db, slug);
    expect(p).toMatchObject({
      slug: "park-bench",
      name: "Park bench",
      description: "Somewhere to sit.",
      tags: ["Decoration"],
      uploader: { steamId: WILL, name: "Will", isPlayer: true },
      pieces: 28,
      bytes: 24067,
      favorites: 0,
      file: bench,
    });
  });

  test("an uploader the boards haven't seen is credited by their Steam persona", async () => {
    const { slug } = await addPrefab(t.db, {
      name: "Park bench",
      description: "",
      tags: [],
      uploader: NEWCOMER,
      uploaderName: "New Kid",
      file: bench,
    });
    // a second Prefab of the same name gets its own link
    expect(slug).toBe("park-bench-2");
    expect((await prefabOf(t.db, slug))?.uploader).toEqual({
      steamId: NEWCOMER,
      name: "New Kid",
      isPlayer: false,
    });
  });

  test("a slug nobody uploaded is null", async () => {
    expect(await prefabOf(t.db, "nope")).toBeNull();
  });
});

describe("the gallery", () => {
  test("every live Prefab as a card, without its file", async () => {
    const cards = await prefabList(t.db);
    expect(cards.map((c) => [c.slug, c.uploader.name, c.pieces, c.favorites, c.tags])).toEqual([
      ["park-bench-2", "New Kid", 28, 0, []],
      ["park-bench", "Will", 28, 0, ["Decoration"]],
    ]);
    expect(cards[0]).not.toHaveProperty("file");
  });
});
