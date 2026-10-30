// The picture a Track's or a Trial's share image is drawn with (components/share/pictures.ts):
// a Track's screenshot from assets/share/, a Trial's own picture as the site serves it, and
// none for a Trial with no picture yet.
import { afterEach, expect, test, vi } from "vitest";

import { boardShot } from "../components/share/pictures";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const asked: Array<string> = [];

afterEach(() => {
  vi.unstubAllGlobals();
  asked.length = 0;
});

function site() {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    asked.push(String(input));
    return Promise.resolve(new Response(JPEG, { headers: { "content-type": "image/jpeg" } }));
  });
}

test("a Track is drawn with its screenshot's JPEG copy", async () => {
  site();
  expect(await boardShot("Map_Track13")).toMatch(/^data:image\/jpeg;base64,/);
  expect(asked).toEqual([]);
});

test("Leth Trial #1 is drawn with its picture", async () => {
  site();
  expect(await boardShot("Map_LethTrial_01")).toBe(
    "data:image/jpeg;base64," + JPEG.toString("base64"),
  );
  expect(asked).toEqual(["https://ballestrecords.com/leth/screenshot.jpg"]);
});

test("a Trial with no picture yet is drawn without one", async () => {
  site();
  expect(await boardShot("Map_TheTower")).toBeNull();
  expect(asked).toEqual([]);
});
