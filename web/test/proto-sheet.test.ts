import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launch } from "../scripts/proto/draw.mjs";
import { compose, cardHtml, overviewHtml, variantsOf } from "../scripts/proto/sheet.mjs";

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
});
