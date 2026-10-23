// Drawing a share image (components/share/Card.tsx): a picture Satori can't read still
// draws the card, without it, rather than failing the route; a Prefab draws itself in 3D.
import { expect, test, vi } from "vitest";

import { drawShare } from "../components/share/Card";
import { prefabShot } from "../components/share/prefab";
import type { ShareCard } from "../lib/share";

const card: ShareCard = {
  kind: "map",
  kicker: "Workshop map · by Tenpin",
  title: "Marble Run",
  headline: { value: "0:42.000", label: "World record · Ninth", tone: "gold" },
  tiles: [{ value: "3", label: "Players" }],
  hue: 120,
};

test("a broken picture draws the card without it", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const res = await drawShare(
    card,
    "data:image/jpeg;base64," + Buffer.from("not a jpeg").toString("base64"),
  );
  expect(res.status).toBe(200);
  expect(warn).toHaveBeenCalledOnce();
  expect(res.headers.get("cache-control")).toContain("s-maxage=31536000");
  const png = Buffer.from(await res.arrayBuffer());
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  warn.mockRestore();
});

test("a Campaign draws its band of Map pictures, a missing one as a blank slice", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const campaign: ShareCard = {
    kind: "campaign",
    kicker: "Campaign · by habibal223366977",
    title: "Solar Trials",
    headline: { value: "Leth", label: "leads with 151,622 pts", tone: "gold" },
    tiles: [
      { value: "9", label: "Maps" },
      { value: "114", label: "Players" },
      { value: "7", label: "Finished every map", tone: "author" },
    ],
    hue: 200,
  };
  const res = await drawShare(campaign, [null, null, null, null, null]);
  expect(res.status).toBe(200);
  expect(warn).not.toHaveBeenCalled();
  const png = Buffer.from(await res.arrayBuffer());
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  warn.mockRestore();
});

test("a Prefab draws its 3D picture across the card", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const file = {
    format: "BallestPrefab",
    version: 1,
    group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
    items: [
      {
        class: "/Game/Blueprints/Editor/BP_Prim_Cube.BP_Prim_Cube_C",
        transform: { location: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        meshes: [
          {
            mesh: "/Game/Art/GreyBoxing/_GENERATED/PC/Box_C559BEB3.Box_C559BEB3",
            materials: ["/Game/M/MI_Env_Red.MI_Env_Red"],
          },
        ],
      },
    ],
  };
  const picture = await prefabShot(JSON.stringify(file), null);
  expect(picture).toMatch(/^data:image\/png;base64,/);
  const prefab: ShareCard = {
    kind: "prefab",
    kicker: "Prefab · by Tenpin",
    title: "Twin cubes",
    headline: null,
    tiles: [{ value: "2", label: "Pieces" }],
    hue: 30,
  };
  const res = await drawShare(prefab, picture);
  expect(res.status).toBe(200);
  expect(warn).not.toHaveBeenCalled();
  expect(await prefabShot("not a prefab", null)).toBeNull();
  warn.mockRestore();
});

test("a Prefab's long name keeps to its column, and its card is kept an hour", async () => {
  const prefab: ShareCard = {
    kind: "prefab",
    kicker: "Prefab · by Tenpin",
    title: "A very long prefab name that goes on and on for sixty-four chars",
    headline: null,
    tiles: [
      { value: "4,096", label: "Pieces" },
      { value: "1,234", label: "Favorites" },
    ],
    hue: 30,
  };
  const res = await drawShare(prefab, null);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe(
    "public, max-age=3600, s-maxage=3600, stale-while-revalidate=60",
  );
});
