// `qa piece`: the viewer's stand-in for each editor mesh against the game mesh's own render.
// The page half (piece-page.ts) is bundled here with esbuild and run in Chromium, so it draws with
// the site's scene code exactly; the reference renders come from ballest-map-making (private, never
// this repo; ADR 0001), framed as piece-math.mjs says.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { launch } from "./browser.mjs";
import { VIEWS } from "./piece-math.mjs";

/* the map-making checkout beside this one, on Will's PC and in a cloud session alike */
export const REFS = fileURLToPath(
  new URL("../../../../ballest-map-making/references/pieces/", import.meta.url),
);

/* the reference files of one mesh as data URLs, or null when any view lacks one */
function refsOf(dir, mesh) {
  const out = {};
  for (const v of VIEWS) {
    const files = ["mask", "ortho"].map((k) => `${dir}${mesh}-${v.name}-${k}.png`);
    if (!files.every((f) => existsSync(f))) return null;
    const [mask, ortho] = files.map(
      (f) => "data:image/png;base64," + readFileSync(f).toString("base64"),
    );
    out[v.name] = { mask, ortho };
  }
  return out;
}

/**
 * Opens a page with the bundled viewer and returns `{ meshes, run, montage }`: every mesh the
 * viewer has a stand-in for, `run(mesh, sheet)`, which draws one and gives
 * `{ kind, scores, sheet }`, and `montage(sheets)`, several sheets in one picture. `close` ends
 * the browser.
 */
export async function pieces(dir) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("./piece-page.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    logLevel: "silent",
  });
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const meshes = await page.evaluate(() => globalThis.meshes());
  return {
    meshes,
    errors,
    async run(mesh, sheet) {
      const refs = refsOf(dir, mesh);
      const r = await page.evaluate(
        ([m, rf, s]) => globalThis.piece(m, rf, s),
        [mesh, refs, sheet],
      );
      return {
        ...r,
        sheet: r.sheet ? Buffer.from(r.sheet.split(",")[1], "base64") : null,
      };
    },
    /* one picture of several sheets (the PNGs run gave), as a PNG */
    async montage(sheets) {
      const urls = sheets.map((b) => `data:image/png;base64,${b.toString("base64")}`);
      const url = await page.evaluate((s) => globalThis.montage(s), urls);
      return Buffer.from(url.split(",")[1], "base64");
    },
    close: () => browser.close(),
  };
}
