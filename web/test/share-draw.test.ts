// Drawing a share image (components/share/Card.tsx): a picture Satori can't read still
// draws the card, without it, rather than failing the route.
import { expect, test, vi } from "vitest";

import { drawShare } from "../components/share/Card";
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
