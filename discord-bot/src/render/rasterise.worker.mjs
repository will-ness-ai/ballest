// The renderer's worker thread (renderer.ts): SVG in, PNG out. Rasterising takes about a second a
// Card, so it runs here and the bot keeps answering meanwhile. Plain JavaScript, so it loads the
// same under tsx, vitest and Node. resvg's image and tree are freed after every PNG: the native
// build never freed its images, and that once ran production out of memory.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const require = createRequire(import.meta.url);
await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));

parentPort.on("message", ({ id, svg, scale }) => {
  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "zoom", value: scale },
      font: { loadSystemFonts: false },
    });
    try {
      const image = resvg.render();
      try {
        const png = image.asPng();
        parentPort.postMessage({ id, png });
      } finally {
        image.free();
      }
    } finally {
      resvg.free();
    }
  } catch (error) {
    parentPort.postMessage({ id, error: String(error) });
  }
});
