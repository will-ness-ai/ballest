import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launch, render } from "../scripts/qa/browser.mjs";

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
  it("finds a placeholder cut off, not one its textarea wraps", async () => {
    const r = await render(browser, base + "/fields", { width: 820, text: 16 }, { now: 0 });
    expect(r.probes?.clipped.map(([where]: [string, number]) => where)).toEqual(["#cut", "#long"]);
  }, 60_000);
});
