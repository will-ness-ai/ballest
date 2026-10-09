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
