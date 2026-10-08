// Draws one view of the site the same way every time, and measures it. A view is a page
// (or a state a click opens on it) at a width and a text size. The run is made repeatable
// here, once, rather than by each check: no animations, one fixed clock, one stand-in picture
// for Steam's images, the refresh time hidden, phones as touch devices with overlay
// scrollbars, and the reader's text size set as a browser setting, as a player would.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { DROP, MASK, STAND_IN } from "./catalogue.mjs";
import { measure, probe } from "./probes.mjs";

const circuit = fileURLToPath(new URL("../../../circuit/", import.meta.url));
const PICTURE = readFileSync(circuit + readdirSync(circuit).find((f) => f.endsWith(".webp")));
const STILL = `*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}
${MASK.join(",")}{visibility:hidden!important}`;
// the tallest stretch of a page compared; a board's list goes on far below
export const MAX_HEIGHT = 4000;

export function launch() {
  // the cloud image's Chromium; elsewhere, the one `npx playwright-core install chromium` fetched
  const cloud = "/opt/pw-browsers/chromium";
  const executablePath = process.env.CHROMIUM ?? (existsSync(cloud) ? cloud : undefined);
  return chromium.launch({ executablePath });
}

/* "player+compare@320/20" -> { page: "player", state: "compare", width: 320, text: 20 } */
export function parseView(name) {
  const m = /^([^+@]+)(?:\+([^@]+))?(?:@(\d+)(?:\/(\d+))?)?$/.exec(name);
  if (!m) return null;
  return { page: m[1], state: m[2], width: Number(m[3] ?? 1280), text: Number(m[4] ?? 16) };
}
export const viewName = ({ page, state, width, text }) =>
  `${page}${state ? "+" + state : ""}@${String(width)}${text === 16 ? "" : "/" + String(text)}`;

/**
 * Loads `url` at the view's size, opens its state by clicking `control`, and returns the
 * page's status, its screenshot, what the layout probes found and the errors it raised,
 * plus the boxes of the elements `boxes` selects and the value of the expression `script`.
 * `skipped` says why there is nothing to compare (a control this width hides).
 */
export async function render(
  browser,
  url,
  view,
  { control, now, full = false, element, boxes, script },
) {
  const phone = view.width < 600;
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: phone ? 844 : 900 },
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    // the carousels hold still, as they do for a reader who asks for less motion
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const errors = [];
  try {
    await page.clock.setFixedTime(now);
    await page.route(DROP, (r) => r.abort());
    await page.route(STAND_IN, (r) =>
      r.fulfill({ status: 200, contentType: "image/webp", body: PICTURE }),
    );
    page.on("pageerror", (e) => errors.push({ where: "page", detail: e.message }));
    page.on("console", (m) => {
      // a failed load is reported once, from its response below
      if (m.type() === "error" && !m.text().startsWith("Failed to load resource"))
        errors.push({ where: "console", detail: m.text() });
    });
    page.on("response", (res) => {
      const req = res.request();
      // the page's own status is the route's business (a 404 page answers 404); `next
      // start` answers some prefetches 404 where Vercel answers 200 (docs/site.md)
      if (res.status() < 400 || req.isNavigationRequest()) return;
      if (req.headers()["next-router-prefetch"]) return;
      errors.push({ where: new URL(res.url()).pathname, detail: String(res.status()) });
    });
    if (view.text !== 16) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Page.setFontSizes", { fontSizes: { standard: view.text, fixed: 13 } });
    }
    // the status of the page's own document, kept as it arrives: a page that replaces its
    // own URL (a redirect in the client) interrupts the goto that asked for it
    let status = 0;
    page.on("response", (res) => {
      if (res.request().isNavigationRequest() && res.frame() === page.mainFrame())
        if (res.status() < 300 || res.status() >= 400) status = res.status();
    });
    for (let i = 0; ; i++) {
      try {
        status = (await page.goto(url, { waitUntil: "commit", timeout: 45_000 }))?.status() ?? 0;
        await page.waitForLoadState("networkidle", { timeout: 45_000 });
        break;
      } catch (e) {
        if (status && /interrupted by another navigation/.test(String(e))) {
          await page.waitForLoadState("networkidle", { timeout: 45_000 });
          break;
        }
        if (i >= 2) throw e;
      }
    }
    await settle(page);
    if (control) {
      const el = page.locator(control).first();
      if (!(await el.isVisible().catch(() => false)))
        return { status, skipped: "control hidden", errors };
      await el.click();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await settle(page);
    }
    const probes = await page.evaluate(probe);
    // measured at the view's own viewport, before the screenshot below grows it
    const measured = boxes ? await page.evaluate(measure, boxes) : undefined;
    const evaluated = script ? await page.evaluate(script) : undefined;
    let shot;
    // an open dialog or sheet covers the viewport, which is all there is to see
    if (control) shot = await (element ? page.locator(element).first() : page).screenshot();
    else {
      // the whole page as one tall viewport rather than Chromium's stitched full-page
      // capture, which moves the fixed background between two runs of the same page
      const height = full ? probes.height : Math.min(probes.height, MAX_HEIGHT);
      await page.setViewportSize({ width: view.width, height });
      // a taller window lets a list's infinite scroll load more: wait until it stops
      for (let last = -1, i = 0; i < 10; i++) {
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await settle(page);
        const count = await page.evaluate(() => document.body.querySelectorAll("*").length);
        if (count === last) break;
        last = count;
      }
      // from the top, as a reader arrives: the entry page scrolls to its row on load
      await page.evaluate(() => {
        scrollTo(0, 0);
      });
      shot = await (element ? page.locator(element).first() : page).screenshot();
    }
    return { status, shot, probes, errors, measured, evaluated };
  } finally {
    await ctx.close();
  }
}

async function settle(page) {
  await page.evaluate(async (still) => {
    if (!document.getElementById("qa-still"))
      document.head.append(
        Object.assign(document.createElement("style"), { id: "qa-still", textContent: still }),
      );
    for (const img of document.images) img.loading = "eager";
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
  }, STILL);
  await page.waitForTimeout(250);
}
