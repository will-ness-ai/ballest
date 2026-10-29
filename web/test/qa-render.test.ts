import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launch, render } from "../scripts/qa/browser.mjs";
import { compare } from "../scripts/qa/compare.mjs";
import { numberLines } from "../scripts/qa/numbers.mjs";

// A board in miniature: rows down the page, and a fetch for more when the window grows, as
// useScrollMore does when qa stretches the window to the page's height. The fetch answers
// slowly, as a cold preview does, and the title says when it has landed.
const PAGE = `<!doctype html><title>first</title><body style="margin:0">
<script>
for (let i = 0; i < 30; i++) document.body.append(Object.assign(document.createElement("div"), { style: "height:100px" }));
addEventListener("resize", () => {
  fetch("/more").then(() => { document.title = "more"; });
}, { once: true });
</script>
<button onclick='fetch("/more").then(() => { document.title = "clicked"; })'>more</button>`;

// Placeholders: a textarea wraps its own onto the lines it has, an input can't.
const FIELDS = `<!doctype html><body style="margin:0;font:16px sans-serif">
<textarea id="wraps" rows="3" style="width:200px;padding:0"
  placeholder="What it is and where it fits in a map"></textarea>
<textarea id="cut" rows="1" style="width:200px;padding:0"
  placeholder="What it is and where it fits in a map, and why it looks the way it does"></textarea>
<input id="long" style="width:200px;padding:0" placeholder="What it is and where it fits in a map">`;

// An entry page in miniature: a head, rows, and the focus row scrolled to on load, as
// BoardBody does.
const LANDS = `<!doctype html><body style="margin:0">
<header style="height:300px"></header>
<script>
for (let i = 0; i < 60; i++) document.body.append(Object.assign(document.createElement("div"), { className: i === 40 ? "row focus" : "row", style: "height:50px" }));
document.querySelector(".focus").scrollIntoView({ block: "center" });
</script>`;

// A button floating over the page on purpose (data-float, as Get the Maps does) over a line
// of text, and two lines drawn over each other by mistake.
const FLOATS = `<!doctype html><body style="margin:0;font:16px sans-serif">
<p id="under" style="margin:0">Rows of the board that scroll under the button</p>
<button data-float style="position:fixed;left:0;top:0">Get the Maps</button>
<p id="a" style="margin:40px 0 0">One line of text</p>
<p id="b" style="margin:-19px 0 0">Another line on it</p>`;

// A page of counts, as live data draws it: the same words, other numbers; a version whose
// heading sits lower, and one whose box below changes colour, as a style change would.
const COUNTS = (n: string, gap: string, colour: string) => `<!doctype html>
<body style="margin:0;font:16px sans-serif">
<h1 style="margin:0 0 ${gap}">Players</h1><p style="margin:0">${n} players have a <b>time</b> today</p>
<p style="margin:0">Maps</p><div style="height:40px;width:200px;background:${colour}"></div>`;

let server: Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/more") setTimeout(() => res.end("ok"), 1500);
    else if (req.url?.startsWith("/api/player/") || req.url === "/api/broken")
      res.writeHead(404).end();
    else if (req.url === "/fetches")
      res
        .setHeader("content-type", "text/html")
        .end(`<script>fetch("/api/player/76561199000000099"); fetch("/api/broken");</script>`);
    else if (req.url === "/api/me")
      res.setHeader("content-type", "application/json").end(
        JSON.stringify({
          id: (req.headers.cookie ?? "").includes("ballest-session=good") ? "7" : null,
        }),
      );
    else if (req.url === "/fields") res.setHeader("content-type", "text/html").end(FIELDS);
    else if (req.url === "/floats") res.setHeader("content-type", "text/html").end(FLOATS);
    else if (req.url?.startsWith("/counts/")) {
      const [, , n, gap, colour] = req.url.split("/");
      res.setHeader("content-type", "text/html").end(COUNTS(n, gap, colour));
    } else if (req.url === "/lands") res.setHeader("content-type", "text/html").end(LANDS);
    else res.setHeader("content-type", "text/html").end(PAGE);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  browser = await launch();
});

afterAll(async () => {
  await browser.close();
  await new Promise((done) => server.close(done));
});

describe("render", () => {
  it("waits for the fetch a taller window starts before it shoots", async () => {
    const r = await render(browser, base + "/", { width: 820, text: 16 }, { now: 0 });
    expect(r.title).toBe("more");
  }, 60_000);

  it("waits for the fetch a state's click starts before it shoots", async () => {
    const view = { width: 820, text: 16 };
    const r = await render(browser, base + "/", view, { now: 0, control: "button" });
    expect(r.title).toBe("clicked");
  }, 60_000);
});

describe("errors", () => {
  it("takes a player API's 404 as an answer, any other as a fault", async () => {
    const r = await render(browser, base + "/fetches", { width: 820, text: 16 }, { now: 0 });
    expect(r.errors).toEqual([{ where: "/api/broken", detail: "404" }]);
  }, 60_000);
});

describe("signing in", () => {
  it("says who the site took the browser for", async () => {
    const view = { width: 820, text: 16 };
    const as = (value: string) => [{ name: "ballest-session", value, url: base }];
    const good = await render(browser, base + "/", view, { now: 0, cookies: as("good") });
    const bad = await render(browser, base + "/", view, { now: 0, cookies: as("bad") });
    expect([good.me, bad.me]).toEqual(["7", null]);
  }, 60_000);
});

describe("probes", () => {
  it("finds where the row a page scrolls to on load sits in the viewport", async () => {
    const r = await render(browser, base + "/lands", { width: 820, text: 16 }, { now: 0 });
    // the 50px row centred in the 900px window
    expect(r.probes?.landed).toBe(425);
    expect(r.probes?.scrolled).toBeGreaterThan(0);
  }, 60_000);

  it("finds text drawn over text, not a floating control over the page", async () => {
    const r = await render(browser, base + "/floats", { width: 820, text: 16 }, { now: 0 });
    expect(r.probes?.overlap.map(([where]: [string, number]) => where)).toEqual(["#b × #a"]);
  }, 60_000);

  it("finds a placeholder cut off, not one its textarea wraps", async () => {
    const r = await render(browser, base + "/fields", { width: 820, text: 16 }, { now: 0 });
    expect(r.probes?.clipped.map(([where]: [string, number]) => where)).toEqual(["#cut", "#long"]);
  }, 60_000);
});

describe("text layout", () => {
  const draw = async (path: string) => {
    const view = { width: 820, text: 16 };
    const { shot, layout } = await render(browser, base + path, view, { now: 0, layout: true });
    if (!shot) throw new Error(`${path} drew nothing`);
    return { shot, layout };
  };

  it("tells numbers that moved apart from a page that moved", async () => {
    const was = (await draw("/counts/1204/0/navy")).layout;
    // the heading, the counts line (its own text, once, around the time) and Maps
    expect(was?.map((l: { text: string }) => l.text)).toEqual([
      "Players",
      "1204 players have a today",
      "time",
      "Maps",
    ]);
    expect(numberLines(was, (await draw("/counts/12,207/0/navy")).layout)).not.toBeNull();
    expect(numberLines(was, (await draw("/counts/1207/24px/navy")).layout)).toBeNull();
  }, 60_000);

  it("says only numbers changed, not when a style changed too", async () => {
    const was = await draw("/counts/1204/0/navy");
    const numbers = async (path: string) =>
      (await compare(browser, was, await draw(path), ["a", "b", "c"])).numbers;
    expect(await numbers("/counts/1207/0/navy")).toBe(true);
    expect(await numbers("/counts/1207/0/teal")).toBe(false);
  }, 60_000);

  it("isn't read unless asked for", async () => {
    const view = { width: 820, text: 16 };
    const r = await render(browser, base + "/counts/1/0/navy", view, { now: 0 });
    expect(r.layout).toBeUndefined();
  }, 60_000);
});
