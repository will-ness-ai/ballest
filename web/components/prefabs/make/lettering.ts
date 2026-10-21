// A sign's fonts (lib/generators.ts letters a sign through a Lettering). Pixel is lib's own 5x7
// table; every other font is drawn on a canvas by the browser and read back as cells, `detail`
// cells to a capital's height, so this runs only in the browser.
import { PIXEL_LETTERING, type Grid, type Lettering } from "../../../lib/generators";

/* each font's name and the CSS font it is drawn in, without a size; the Google ones load on
   the sign's page (FONTS_HREF) */
export const FONTS: ReadonlyArray<readonly [name: string, css: string]> = [
  ["Pixel", ""],
  ["Bungee", '"Bungee"'],
  ["Chakra Petch", '700 "Chakra Petch"'],
  ["Archivo", '800 "Archivo"'],
  ["Bebas Neue", '"Bebas Neue"'],
  ["Press Start", '"Press Start 2P"'],
  ["Rubik Mono", '"Rubik Mono One"'],
  ["Lobster", '"Lobster"'],
  ["Handwritten", '700 "Caveat"'],
  ["Serif", '700 Georgia, "Times New Roman", serif'],
  ["Typewriter", '700 "Courier New", monospace'],
];
/* the fonts the site doesn't already load */
export const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Caveat:wght@700&family=Lobster&family=Press+Start+2P&family=Rubik+Mono+One&display=swap";

/* a font's CSS at a size: the weight, if any, stays in front */
export const fontAt = (css: string, size: string) =>
  /^\d+ /.test(css) ? css.replace(/^(\d+) /, `$1 ${size} `) : `${size} ${css}`;

const SIZE = 100;
/* each cell is read 4x4 finer and is on when most of its middle is ink */
const FINE = 4;

/* the lettering for a font by name, `detail` cells to a capital's height */
export function letteringOf(font: string, detail: number): Lettering {
  const css = FONTS.find((f) => f[0] === font)?.[1];
  if (!css) return PIXEL_LETTERING;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return PIXEL_LETTERING;
  ctx.font = fontAt(css, `${String(SIZE)}px`);
  const capH = ctx.measureText("H").actualBoundingBoxAscent || SIZE * 0.7;
  const unit = capH / detail;
  const lineH = SIZE * 1.2;
  return {
    keepsCase: true,
    width: (line) => ctx.measureText(line).width / unit,
    lineHeight: lineH / unit,
    grid: (lines) => draw(lines, css, unit, lineH, capH),
  };
}

function draw(
  lines: Array<string>,
  css: string,
  unit: number,
  lineH: number,
  capH: number,
): Grid | null {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  probe.font = fontAt(css, `${String(SIZE)}px`);
  const wide = Math.max(...lines.map((l) => probe.measureText(l).width));
  const cols = Math.ceil(wide / unit) + 4;
  const rows = Math.ceil((lines.length * lineH) / unit) + 4;
  const canvas = document.createElement("canvas");
  canvas.width = cols * FINE;
  canvas.height = rows * FINE;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.scale(FINE / unit, FINE / unit);
  g.font = fontAt(css, `${String(SIZE)}px`);
  g.textAlign = "center";
  lines.forEach((l, i) =>
    g.fillText(l, (cols * unit) / 2, 2 * unit + i * lineH + (lineH + capH) / 2),
  );
  const ink = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const on = (x: number, y: number) => {
    let hits = 0;
    for (let j = 1; j < FINE; j += 2)
      for (let i = 1; i < FINE; i += 2)
        if (ink[((y * FINE + j) * canvas.width + x * FINE + i) * 4 + 3] > 127) hits++;
    return hits >= 2;
  };
  let [x0, x1, y0, y1] = [cols, -1, rows, -1];
  const cells = new Set<number>();
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (on(x, y)) {
        cells.add(y * cols + x);
        [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
      }
  if (x1 < 0) return null;
  return {
    w: x1 - x0 + 1,
    h: y1 - y0 + 1,
    on: (x, y) => cells.has((y + y0) * cols + x + x0),
  };
}
