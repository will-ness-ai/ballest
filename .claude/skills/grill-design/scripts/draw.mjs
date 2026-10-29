// Draws one variant of a grill-design prototype page, for sheet.mjs. Kept apart from `pnpm qa`
// on purpose: it needs nothing but playwright-core, borrowed from web/'s install. What it does is the little a round's pictures need:
// load the page at a width, wait for it to settle, hide the picker and `next dev`'s badge,
// and screenshot the page's top or one element.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

// the repo root installs nothing, so resolve playwright-core from web/
const { chromium } = createRequire(new URL("../../../../web/package.json", import.meta.url))(
  "playwright-core",
);

// the tallest stretch of a page drawn; a round's pictures cut far shorter than this anyway
const MAX_HEIGHT = 4000;
// the preview toolbar and analytics only keep the network busy
const DROP = /vercel\.live|plausible|railway\.app/;
const HIDE = `.proto-picker,.proto-frame,nextjs-portal{display:none!important}
*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}`;

export function launch() {
  // the cloud image's Chromium; elsewhere, the one `npx playwright-core install chromium` fetched
  const cloud = "/opt/pw-browsers/chromium";
  const executablePath = process.env.CHROMIUM ?? (existsSync(cloud) ? cloud : undefined);
  return chromium.launch({ executablePath });
}

/**
 * The picker's list of variants (its `data-variants`), from one plain load: null when the page
 * has no picker. Throws when the page doesn't load.
 * @param {import("playwright-core").Browser} browser
 * @param {string} url
 */
export async function pickerList(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    await page.waitForSelector(".proto-picker", { timeout: 15_000 }).catch(() => null);
    return await page.evaluate(
      `document.querySelector(".proto-picker")?.getAttribute("data-variants") ?? null`,
    );
  } finally {
    await page.close();
  }
}

/**
 * One view of the page: its status, screenshot (of `element` when given, else the page's top),
 * the errors it raised, and, with `box`, where that element ends on the page (px from the top).
 * A missing `element` is reported as `missing` and a page that fails to load or draw as
 * `failed` (its first line), never thrown. Every view of a round shares the clock at `now`, so
 * nothing that counts time differs between them.
 * @param {import("playwright-core").Browser} browser
 * @param {string} url
 * @param {number} width
 * @param {{ element?: string, box?: string, now?: number }} options
 */
export async function draw(browser, url, width, { element, box, now = Date.now() } = {}) {
  const phone = width < 600;
  const ctx = await browser.newContext({
    viewport: { width, height: phone ? 844 : 900 },
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push({ where: "page", detail: e.message }));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource"))
      errors.push({ where: "console", detail: m.text() });
  });
  try {
    await page.clock.setFixedTime(now);
    await page.route(DROP, (r) => r.abort());
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    const status = res?.status() ?? 0;
    if (status >= 400) return { status, errors };
    await page.addStyleTag({ content: HIDE });
    await page.evaluate(async () => {
      for (const img of document.images) img.loading = "eager";
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
    });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width, height: Math.min(height, MAX_HEIGHT) });
    await page.waitForTimeout(300);
    // from the top, as a reader arrives, whatever the page scrolled to on load
    await page.evaluate(() => {
      scrollTo(0, 0);
    });
    const ends = box
      ? await page.evaluate((sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return r ? Math.round(r.bottom + scrollY) : undefined;
        }, box)
      : undefined;
    if (element && !(await page.locator(element).count())) return { status, missing: true, errors };
    const shot = await (element ? page.locator(element).first() : page).screenshot({
      timeout: 30_000,
    });
    return { status, shot, errors, ends };
  } catch (e) {
    return { status: 0, failed: String(e).split("\n")[0], errors };
  } finally {
    await ctx.close();
  }
}
