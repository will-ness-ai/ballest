import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launch as launchAny } from "../../.claude/skills/grill-design/scripts/draw.mjs";
import {
  compose as composeAny,
  cardHtml,
  imagesOf,
  overviewHtml,
  pictureCardHtml,
  pictureOverviewHtml,
  variantsOf,
} from "../../.claude/skills/grill-design/scripts/pictures.mjs";

// the scripts live in grill-design, outside web/, where playwright-core's types don't resolve
const launch = launchAny as () => Promise<Browser>;
const compose = composeAny as (browser: Browser, html: string) => Promise<Buffer>;

// a plain PNG of the given size, drawn by the browser, to stand in for a variant's shot
async function png(browser: Browser, width: number, height: number) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:#3a6">`);
  const shot = await page.screenshot();
  await page.close();
  return shot;
}

/* a JPEG's pixel size, from its SOF0 marker */
function jpegSize(b: Buffer) {
  for (let i = 2; i < b.length;) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2)
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

describe("variantsOf", () => {
  const LIST = JSON.stringify([
    ["A", "Cards", "a card each"],
    ["B", "Banners"],
  ]);

  it("reads the picker's list, with each variant's note", () => {
    expect(variantsOf(LIST)).toEqual({
      variants: [
        { key: "A", name: "Cards", note: "a card each" },
        { key: "B", name: "Banners", note: "" },
      ],
    });
  });

  it("cuts it to --variants, trimmed", () => {
    expect(variantsOf(LIST, { variants: " B," })).toEqual({
      variants: [{ key: "B", name: "Banners", note: "" }],
    });
  });

  it("takes --variants as they are on a page with no list", () => {
    expect(variantsOf(null, { variants: "A,C" })).toEqual({
      variants: [
        { key: "A", name: "", note: "" },
        { key: "C", name: "", note: "" },
      ],
    });
  });

  it("skips entries that aren't [key, name, note]", () => {
    expect(variantsOf(JSON.stringify([{ key: "A" }, null, ["B", "Banners"]]))).toEqual({
      variants: [{ key: "B", name: "Banners", note: "" }],
    });
  });

  it("refuses a key or a pick the picker doesn't list, naming the ones it does", () => {
    expect(variantsOf(LIST, { variants: "A,D" })).toEqual({
      error: 'no variant "D"',
      help: "variants: A, B",
    });
    expect(variantsOf(LIST, { pick: "b" })).toEqual({
      error: 'no variant "b" to pick',
      help: "variants: A, B",
    });
  });

  it("says how to name them when nothing does", () => {
    expect(variantsOf("not json")).toHaveProperty("help", expect.stringMatching(/--variants/));
  });
});

describe("imagesOf", () => {
  const LIST = [
    ["A", "As is", "today's layout"],
    ["B", "Banner", "yesterday's Daily on top"],
  ];
  const folder = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "sheet-"));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  };

  it("pairs each variant in variants.json with its picture, named by its key", () => {
    const dir = folder({
      "variants.json": JSON.stringify(LIST),
      "A.png": "a",
      "B.jpg": "b",
      "notes.txt": "",
    });
    expect(imagesOf(dir)).toEqual({
      variants: [
        { key: "A", name: "As is", note: "today's layout", file: join(dir, "A.png") },
        { key: "B", name: "Banner", note: "yesterday's Daily on top", file: join(dir, "B.jpg") },
      ],
    });
  });

  it("cuts them to --variants", () => {
    const dir = folder({ "variants.json": JSON.stringify(LIST), "A.png": "a", "B.png": "b" });
    expect(imagesOf(dir, { variants: "B" })).toHaveProperty("variants.length", 1);
  });

  it("asks for variants.json, showing its shape, when the folder has none", () => {
    const dir = folder({ "A.png": "a" });
    const r = imagesOf(dir);
    expect(r).toHaveProperty("error", `no ${join(dir, "variants.json")}`);
    expect(r).toHaveProperty(
      "help",
      expect.stringContaining('[["A", "<name>", "<what it changes>"], ...]') as unknown,
    );
  });

  it("names a variant whose picture is missing", () => {
    const dir = folder({ "variants.json": JSON.stringify(LIST), "A.png": "a" });
    expect(imagesOf(dir)).toEqual({
      error: "no picture for B",
      help: `save it as ${join(dir, "B.png")} (or .jpg, .jpeg, .webp)`,
    });
  });

  it("says so when the folder isn't there", () => {
    expect(imagesOf(join(tmpdir(), "no-such-sheet-dir"))).toHaveProperty(
      "error",
      expect.stringMatching(/^no folder /),
    );
  });

  it("refuses a pick it doesn't list", () => {
    const dir = folder({ "variants.json": JSON.stringify(LIST), "A.png": "a", "B.png": "b" });
    expect(imagesOf(dir, { pick: "C" })).toHaveProperty("error", 'no variant "C" to pick');
  });
});

describe("the pictures", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  it("draws a variant's card as one JPEG at the sheet's width, desktop beside phone", async () => {
    const card = await compose(
      browser,
      cardHtml(
        { key: "A", name: "Cards", note: "a card each" },
        { desktop: await png(browser, 1280, 700), phone: await png(browser, 390, 1500) },
        { pick: true, title: "Trials" },
      ),
    );
    const size = jpegSize(card);
    expect(size?.w).toBe(1400);
    // a tall phone shot is cut, not drawn at full length
    expect(size?.h).toBeLessThan(1400);
  });

  it("draws the desktop shot in a browser with the page's address, the phone shot in a phone", async () => {
    const html = cardHtml(
      { key: "A", name: "Cards", note: "" },
      { desktop: await png(browser, 1280, 600), phone: await png(browser, 390, 600) },
      { address: "ballestrecords.com/trials" },
    );
    expect(html).toMatch(/class="browser"[^]*ballestrecords\.com\/trials/);
    expect(html).toMatch(/class="phone"[^]*class="status"[^]*class="home"/);
  });

  it("shows the page down to the feature's end, however far down it sits", async () => {
    const shots = { desktop: await png(browser, 1280, 3000), phone: await png(browser, 390, 900) };
    const cut = jpegSize(await compose(browser, cardHtml({ key: "A", name: "", note: "" }, shots)));
    const down = jpegSize(
      await compose(
        browser,
        cardHtml(
          { key: "A", name: "", note: "" },
          { ...shots, desktopUpTo: 2600 },
          { badge: "in the page" },
        ),
      ),
    );
    expect(down?.h).toBeGreaterThan((cut?.h ?? Infinity) + 500);
  });

  it("draws every variant in one overview, a row each", async () => {
    const shots = { desktop: await png(browser, 1280, 600), phone: await png(browser, 390, 800) };
    const one = jpegSize(
      await compose(browser, overviewHtml([{ v: { key: "A", name: "", note: "" }, ...shots }], {})),
    );
    const three = jpegSize(
      await compose(
        browser,
        overviewHtml(
          ["A", "B", "C"].map((key) => ({ v: { key, name: "", note: "" }, ...shots })),
          { pick: "B" },
        ),
      ),
    );
    expect(three?.w).toBe(1400);
    expect(three?.h).toBeGreaterThan((one?.h ?? Infinity) * 2);
  });

  it("labels every variant with its letter, name and note, in the overview and on its card", async () => {
    const v = { key: "C", name: "Headline", note: "the leader up top" };
    const shots = { desktop: await png(browser, 1280, 600), phone: await png(browser, 390, 800) };
    for (const html of [
      overviewHtml([{ v, ...shots }], {}),
      cardHtml(v, shots),
      pictureOverviewHtml([{ v, picture: shots.desktop }], {}),
      pictureCardHtml(v, shots.desktop),
    ]) {
      expect(html).toContain('<b class="key">C</b>');
      expect(html).toContain("Headline");
      expect(html).toContain("the leader up top");
    }
  });

  it("lays tall pictures side by side in the overview, and wide ones a row each", async () => {
    const sheet = async (w: number, h: number, n: number) => {
      const picture = await png(browser, w, h);
      return jpegSize(
        await compose(
          browser,
          pictureOverviewHtml(
            "ABCDE"
              .slice(0, n)
              .split("")
              .map((key) => ({ v: { key, name: "", note: "" }, picture })),
            { pick: "B" },
          ),
        ),
      );
    };
    const tall = await sheet(800, 1600, 5);
    expect(tall?.w).toBe(1400);
    // five 800x1600 pictures in one row, each about 260 px wide, so about 520 px tall
    expect(tall?.h).toBeLessThan(900);
    const oneWide = await sheet(1600, 800, 1);
    const threeWide = await sheet(1600, 800, 3);
    expect(threeWide?.h).toBeGreaterThan((oneWide?.h ?? Infinity) * 2.5);
  });

  it("draws a picture's card at the sheet's width, the whole picture shown", async () => {
    const card = jpegSize(
      await compose(
        browser,
        pictureCardHtml({ key: "A", name: "", note: "" }, await png(browser, 676, 2000), {
          pick: true,
        }),
      ),
    );
    expect(card?.w).toBe(1400);
    // shown at its own size, not cut
    expect(card?.h).toBeGreaterThan(2000);
  });
});
