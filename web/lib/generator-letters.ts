// A sign's lettering (lib/generators.ts): how wide a line is and how tall a line steps, in
// cells, and the grid of cells a set of lines makes. The Pixel font is a 5x7 table here; every
// other font is drawn by the browser (components/prefabs/make/lettering.ts) behind the same
// interface, so this stays pure and the tests letter in Pixel.

/* a w by h grid of cells, row 0 at the top */
export interface Grid {
  w: number;
  h: number;
  on: (x: number, y: number) => boolean;
}

export interface Lettering {
  /* whether it draws lower case (Pixel has capitals only) */
  keepsCase: boolean;
  /* a line's width and a line's step down, in cells */
  width: (line: string) => number;
  lineHeight: number;
  /* the lines centred one under another, trimmed to their ink; null when there is none */
  grid: (lines: Array<string>) => Grid | null;
}

/* the text broken into lines of at most `per` letters, at spaces where it can be; a word longer
   than a line is split */
export function wrapAt(text: string, per: number, keepCase: boolean): Array<string> {
  const lines: Array<string> = [];
  for (const para of (keepCase ? text : text.toUpperCase()).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean))
      for (let w = word; w;) {
        const room = line ? per - line.length - 1 : per;
        if (w.length <= room) {
          line = line ? line + " " + w : w;
          w = "";
        } else if (!line) {
          lines.push(w.slice(0, per));
          w = w.slice(per);
        } else {
          lines.push(line);
          line = "";
        }
      }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

/* each glyph's seven rows of five, 1 for ink; a character it lacks is drawn as ? */
const PIXEL: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 10001 11001 10101 10011 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110",
  "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010",
  "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110",
  "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100",
  ".": "00000 00000 00000 00000 00000 01100 01100",
  ",": "00000 00000 00000 00000 01100 00100 01000",
  "!": "00100 00100 00100 00100 00100 00000 00100",
  "?": "01110 10001 00001 00010 00100 00000 00100",
  "-": "00000 00000 00000 11111 00000 00000 00000",
  "'": "00100 00100 01000 00000 00000 00000 00000",
  ":": "00000 01100 01100 00000 01100 01100 00000",
  "/": "00001 00010 00010 00100 01000 01000 10000",
  "&": "01100 10010 10100 01000 10101 10010 01101",
  "+": "00000 00100 00100 11111 00100 00100 00000",
  "#": "01010 01010 11111 01010 11111 01010 01010",
  "<": "00010 00100 01000 10000 01000 00100 00010",
  ">": "01000 00100 00010 00001 00010 00100 01000",
  " ": "00000 00000 00000 00000 00000 00000 00000",
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const glyph = (ch: string) => (PIXEL[ch] ?? PIXEL["?"]).split(" ");

export const PIXEL_LETTERING: Lettering = {
  keepsCase: false,
  width: (line) => line.length * (GLYPH_W + 1) - 1,
  lineHeight: GLYPH_H + 1,
  grid: (lines) => {
    const w = Math.max(...lines.map((l) => l.length * (GLYPH_W + 1) - 1));
    const h = lines.length * (GLYPH_H + 1) - 1;
    const cells = new Set<number>();
    lines.forEach((line, li) => {
      const left = Math.floor((w - (line.length * (GLYPH_W + 1) - 1)) / 2);
      Array.from(line).forEach((ch, ci) => {
        const rows = glyph(ch);
        for (let y = 0; y < GLYPH_H; y++)
          for (let x = 0; x < GLYPH_W; x++)
            if (rows[y][x] === "1")
              cells.add((li * (GLYPH_H + 1) + y) * w + left + ci * (GLYPH_W + 1) + x);
      });
    });
    return cells.size ? { w, h, on: (x, y) => cells.has(y * w + x) } : null;
  },
};
