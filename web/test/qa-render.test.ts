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

let server: Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/more") setTimeout(() => res.end("ok"), 1500);
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
