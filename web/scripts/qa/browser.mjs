// Draws one view of the site the same way every time, and measures it. A view is a page
// (or a state a click opens on it) at a width and a text size. The run is made repeatable
// here, once, rather than by each check: no animations, one fixed clock, one stand-in picture
// for Steam's images, the refresh time hidden, phones as touch devices with overlay
// scrollbars, and the reader's text size set as a browser setting, as a player would.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { DROP, MASK, STAND_IN } from "./catalogue.mjs";

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
    let status = 0;
    for (let i = 0; ; i++) {
      try {
        // past the first response a page may replace its own URL (a redirect in the client),
        // which a goto waiting for the network would take as a failure
        status = (await page.goto(url, { waitUntil: "commit", timeout: 45_000 }))?.status() ?? 0;
        await page.waitForLoadState("networkidle", { timeout: 45_000 });
        break;
      } catch (e) {
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

/*
 * Runs in the page. Four faults a reader sees whatever the design meant:
 * - overflow: the page scrolls sideways;
 * - offscreen: an element reaches past the viewport with nothing clipping or scrolling it;
 * - clipped: text cut off by its box with no ellipsis to say so;
 * - overlap: a line of text drawn over another.
 * Each is reported at its outermost element, as a short selector.
 */
function probe() {
  const vw = document.documentElement.clientWidth;
  const label = (el) => {
    if (el.id) return "#" + el.id;
    const cls = [...el.classList].slice(0, 2).join(".");
    const parent = el.parentElement;
    const own = el.tagName.toLowerCase() + (cls ? "." + cls : "");
    if (cls || !parent || parent === document.body) return own;
    return label(parent) + " > " + own;
  };
  const visible = (el, r) =>
    r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  // an ancestor that clips or scrolls sideways, which makes reaching past the viewport fine
  const held = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement)
      if (getComputedStyle(a).overflowX !== "visible") return true;
    return false;
  };
  const offscreen = new Map();
  const clipped = new Map();
  const pastOf = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 ? Math.max(r.right - vw, -r.left) : 0;
  };
  const add = (map, el, px, inner = el) => {
    const k = label(el) + (inner === el ? "" : " … " + label(inner));
    map.set(k, Math.max(map.get(k) ?? 0, Math.round(px)));
  };
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("[hidden], [aria-hidden=true], dialog:not([open])")) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const past = pastOf(el);
    if (past > 1 && !held(el) && !(pastOf(el.parentElement) > 1)) {
      // name the outermost element and, inside it, the one holding it open: follow down the
      // child whose hiding lets the box back in, or when several each hold it (cards in a
      // column), the one whose content is widest
      let inner = el;
      for (;;) {
        const wide = [...inner.children].filter((c) => pastOf(c) > 1);
        if (!wide.length) break;
        const frees = (c) => {
          const keep = c.style.display;
          c.style.display = "none";
          const freed = pastOf(el) < past - 1;
          c.style.display = keep;
          return freed;
        };
        // the widest by its own content, not by the width it was stretched to
        const least = (c) => {
          const keep = c.style.width;
          c.style.width = "min-content";
          const w = c.getBoundingClientRect().width;
          c.style.width = keep;
          return w;
        };
        inner =
          wide.find(frees) ??
          wide.map((c) => [c, least(c)]).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
      }
      add(offscreen, el, past, inner);
    }
    const cs = getComputedStyle(el);
    if (
      (cs.overflowX === "hidden" || cs.overflowX === "clip") &&
      cs.textOverflow !== "ellipsis" &&
      el.scrollWidth > el.clientWidth + 1 &&
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    )
      add(clipped, el, el.scrollWidth - el.clientWidth);
  }
  /* runs in the page: lines of text drawn over other text. Each line is cut to the boxes
     that clip it (an ellipsis hides the rest), and only the open dialog counts while one is. */
  function overlaps() {
    const modal = document.querySelector("dialog[open]:modal");
    const clips = new Map();
    const clipOf = (el) => {
      if (!el || el === document.body) return null;
      if (clips.has(el)) return clips.get(el);
      let c = clipOf(el.parentElement);
      const cs = getComputedStyle(el);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const r = el.getBoundingClientRect();
        c = c
          ? {
              l: Math.max(c.l, r.left),
              t: Math.max(c.t, r.top),
              r: Math.min(c.r, r.right),
              b: Math.min(c.b, r.bottom),
            }
          : { l: r.left, t: r.top, r: r.right, b: r.bottom };
      }
      clips.set(el, c);
      return c;
    };
    const lines = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el) continue;
      if (el.closest("[hidden], [aria-hidden=true], dialog:not([open]), script, style")) continue;
      if (modal && !modal.contains(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const c = clipOf(el);
      for (const r of range.getClientRects()) {
        // the middle of the line box: glyphs, not the leading above and below them
        const pad = r.height * 0.25;
        const box = { l: r.left, t: r.top + pad, r: r.right, b: r.bottom - pad };
        if (c)
          Object.assign(box, {
            l: Math.max(box.l, c.l),
            t: Math.max(box.t, c.t),
            r: Math.min(box.r, c.r),
            b: Math.min(box.b, c.b),
          });
        if (box.r - box.l > 1 && box.b - box.t > 1) lines.push({ n, el, ...box });
      }
    }
    lines.sort((a, b) => a.t - b.t);
    const found = new Map();
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length && lines[j].t < lines[i].b; j++) {
        const a = lines[i],
          b = lines[j];
        if (a.n === b.n) continue;
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        if (w <= 2) continue;
        const k = label(a.el) + " × " + label(b.el);
        found.set(k, Math.max(found.get(k) ?? 0, Math.round(w)));
      }
    return [...found].slice(0, 5);
  }

  const doc = document.scrollingElement;
  return {
    height: doc.scrollHeight,
    overflow: Math.max(0, doc.scrollWidth - vw),
    offscreen: [...offscreen],
    clipped: [...clipped],
    overlap: overlaps(),
  };
}

/* runs in the page: each match's box, rounded, with the start of its text */
function measure(selector) {
  return [...document.querySelectorAll(selector)].slice(0, 40).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      right: Math.round(r.right),
      y: Math.round(r.top + scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
      text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30),
    };
  });
}
