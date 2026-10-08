// Screenshots a page, or one element of it, the way a player's browser draws it: for
// checking a front-end change by eye (docs/site.md, "Checking a change").
//
//   pnpm shot <url> <out.png> [selector] [width]
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const [url, out, selector, width = "1280"] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: pnpm shot <url> <out.png> [selector] [width]");
  process.exit(2);
}
/* the cloud image's Chromium; elsewhere, the one `npx playwright-core install chromium` fetched */
const cloud = "/opt/pw-browsers/chromium";
const executablePath = process.env.CHROMIUM ?? (existsSync(cloud) ? cloud : undefined);

const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await (selector ? page.locator(selector).first() : page).screenshot({
    path: out,
    fullPage: !selector,
  });
  console.log(out);
} finally {
  await browser.close();
}
