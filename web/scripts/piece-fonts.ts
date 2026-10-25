// tsx scripts/piece-fonts.ts [dir]: turns R23's handbuilt alphabets, uploaded to the site as
// Prefabs, into the Sign's piece fonts (lib/generators/piece-fonts.json, read by
// lib/generators/piece-fonts.ts). Each Prefab lies flat, reading along +X with its letters' tops
// toward -Y; GLYPHS names which pieces make each character. A glyph's pieces are stood up to
// read along +Y facing -X, as a sign does, with its left edge at y 0, its baseline at z 0 and
// its front at x 0. The files come from the site, or from `dir` (`<slug>.json`) when given.
// Run it again only when the Prefabs change; nothing reads them at runtime.
import { readFileSync, writeFileSync } from "node:fs";

import { rotationRows, shapesOf, spanOf, type PrefabFile, type PrefabItem } from "../lib/prefab";
import { rotOf, type V3 } from "../lib/generators/pieces";

/* each sheet's glyphs: per row, its baseline's glyph (on the baseline in any font) then each
   character and its pieces' places in the file. "^" is a glyph on each sheet the fonts leave
   out: a peak with a bar under it, which no key types. `also` are characters the sheet has no
   glyph for, made from another's pieces: a full stop from the !'s dot, a colon from the ÷'s dots
   and an apostrophe from the ”'s first mark */
interface Row {
  base: string;
  glyphs: Record<string, Array<number>>;
  also?: Record<string, Array<number>>;
}
const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const GRADUATE_LETTERS: Array<Row> = [
  {
    base: "A",
    glyphs: {
      A: span(7, 12),
      B: span(13, 22),
      C: span(36, 40),
      D: span(57, 62),
      E: span(63, 68),
      F: span(69, 73),
      G: span(89, 95),
      H: span(102, 108),
      I: span(114, 116),
      J: span(126, 129),
      K: span(130, 136),
      L: span(143, 146),
      M: span(147, 155),
    },
  },
  {
    base: "N",
    glyphs: {
      N: span(0, 6),
      O: span(23, 28),
      P: span(29, 35),
      Q: span(41, 47),
      R: span(48, 56),
      S: span(74, 83),
      T: span(84, 88),
      U: span(96, 101),
      V: span(109, 113),
      W: span(117, 125),
      X: span(137, 142),
      Y: span(156, 161),
      Z: span(162, 166),
    },
  },
];

const GRADUATE_SYMBOLS: Array<Row> = [
  {
    base: "1",
    glyphs: {
      "1": span(123, 125),
      "2": span(114, 122),
      "3": span(106, 113),
      "4": span(102, 105),
      "5": span(94, 101),
      "6": span(85, 93),
      "7": span(81, 84),
      "8": span(69, 80),
      "9": span(60, 68),
      "0": span(53, 59),
    },
  },
  {
    base: "!",
    glyphs: {
      "!": [18, 19],
      ",": [20, 21],
      "?": span(22, 27),
      "#": span(28, 31),
      "*": span(32, 34),
      "+": [35, 36],
      "-": [37],
      "×": [38, 39],
      "÷": span(40, 42),
      "=": [43, 44],
      "“": span(45, 48),
      "”": span(49, 52),
    },
    also: { ".": [19], ":": [41, 42], "'": [49, 52] },
  },
  {
    base: "^",
    glyphs: { "^": span(15, 17), "[": span(12, 14), "]": span(9, 11), "@": span(0, 8) },
  },
];

const LEKER_LETTERS: Array<Row> = [
  {
    base: "a",
    glyphs: {
      a: span(0, 4),
      b: span(5, 9),
      c: span(10, 12),
      d: span(13, 17),
      e: span(18, 22),
      f: span(23, 25),
      g: span(75, 80),
      h: span(81, 84),
      i: span(85, 87),
      j: [88, 89],
      k: span(90, 92),
      l: span(93, 95),
      m: span(96, 100),
    },
  },
  {
    base: "n",
    glyphs: {
      n: span(26, 29),
      o: span(30, 33),
      p: span(34, 38),
      q: span(39, 43),
      r: span(44, 46),
      s: span(47, 49),
      t: [50, 51],
      u: span(71, 74),
      v: span(68, 70),
      w: span(63, 67),
      x: [61, 62],
      y: span(55, 60),
      z: span(52, 54),
    },
  },
];

const LEKER_SYMBOLS: Array<Row> = [
  {
    base: "1",
    glyphs: {
      "1": [0, 1],
      "2": span(2, 5),
      "3": span(6, 10),
      "4": span(11, 13),
      "5": span(14, 19),
      "6": span(20, 24),
      "7": [25, 26],
      "8": span(27, 32),
      "9": span(33, 37),
      "0": span(38, 43),
    },
  },
  {
    base: "!",
    glyphs: {
      "!": [44, 45],
      ",": [46, 47],
      "?": span(48, 52),
      "#": span(53, 56),
      "*": span(57, 59),
      "+": [60, 61],
      "-": [62],
      "×": [63, 64],
      "÷": span(65, 67),
      "=": [68, 69],
      "“": span(70, 73),
      "”": span(74, 77),
    },
    also: { ".": [45], ":": [66, 67], "'": [75, 77] },
  },
  {
    base: "^",
    glyphs: { "^": span(78, 80), "(": span(81, 83), ")": span(84, 86), "@": span(87, 94) },
  },
];

const FONTS = [
  {
    name: "Graduate",
    sheets: [
      { slug: "graduate-alphabet", rows: GRADUATE_LETTERS },
      { slug: "graduatenumberssymbols", rows: GRADUATE_SYMBOLS },
    ],
  },
  {
    name: "Leker",
    sheets: [
      { slug: "leker-alphabet", rows: LEKER_LETTERS },
      { slug: "leker-numbers-symbols", rows: LEKER_SYMBOLS },
    ],
  },
];

const dir = process.argv[2];
async function sheetOf(slug: string): Promise<PrefabFile> {
  if (dir) return JSON.parse(readFileSync(`${dir}/${slug}.json`, "utf8")) as PrefabFile;
  const res = await fetch(`https://ballestrecords.com/api/prefabs/${slug}/file`);
  if (!res.ok) throw new Error(`${slug}: ${String(res.status)}`);
  return (await res.json()) as PrefabFile;
}

/* where the pieces reach on the sheet, in cm: x across, y down the letters, z out of the top */
function boundsOf(items: Array<PrefabItem>) {
  const shapes = shapesOf({ format: "BallestPrefab", version: 1, group: GROUP, items });
  /* three's axes: x is Unreal's x, y (up) its z, z its y */
  const reach = (k: number) => {
    const s = shapes.map((sh) => spanOf(sh, k));
    return [Math.min(...s.map((v) => v[0])) * 100, Math.max(...s.map((v) => v[1])) * 100];
  };
  const [x, z, y] = [reach(0), reach(1), reach(2)];
  return { x, y, z };
}
const GROUP = { rotation: [0, 0, 0] as V3, scale: [1, 1, 1] as V3 };

/* the sheet's axes stood up: reading (+X) along +Y, the letters' tops (-Y) up, their top face
   (+Z) toward -X */
const stand = ([x, y, z]: V3): V3 => [-z, x, -y];
const round = (n: number, places: number) => Number(n.toFixed(places)) + 0;

const out: Record<string, unknown> = {};
for (const font of FONTS) {
  const glyphs: Record<string, { w: number; top: number; low: number; pieces: Array<unknown> }> =
    {};
  const classes: Array<string> = [];
  const meshes: Array<string> = [];
  const indexIn = (list: Array<string>, s: string) =>
    list.includes(s) ? list.indexOf(s) : list.push(s) - 1;
  for (const sheet of font.sheets) {
    const file = await sheetOf(sheet.slug);
    const used = new Set<number>();
    for (const row of sheet.rows) {
      const baseline = boundsOf(row.glyphs[row.base].map((i) => file.items[i])).y[1];
      for (const [ch, places] of [
        ...Object.entries(row.glyphs),
        ...Object.entries(row.also ?? {}),
      ]) {
        if (row.glyphs[ch] === places)
          for (const i of places) {
            if (used.has(i)) throw new Error(`${sheet.slug}: piece ${String(i)} in two glyphs`);
            used.add(i);
          }
        if (ch === "^") continue;
        const items = places.map((i) => file.items[i]);
        const b = boundsOf(items);
        const origin: V3 = [b.x[0], baseline, b.z[1]];
        glyphs[ch] = {
          w: round(b.x[1] - b.x[0], 1),
          top: round(baseline - b.y[0], 1),
          low: round(b.y[1] - baseline, 1),
          pieces: items.map((it) => {
            if (it.meshes.length !== 1)
              throw new Error(`${sheet.slug}: a piece of ${ch} has no one mesh`);
            const [ax, , az] = rotationRows(it.transform.rotation);
            const rot = rotOf(stand(ax), stand(az));
            const at = stand(it.transform.location.map((v, k) => v - origin[k]) as V3);
            return [
              indexIn(classes, it.class),
              indexIn(meshes, it.meshes[0].mesh),
              it.meshes[0].materials.length,
              ...at.map((v) => round(v, 1)),
              ...rot.map((v) => round(v, 3)),
              ...it.transform.scale.map((v) => round(v, 4)),
            ];
          }),
        };
      }
    }
    if (used.size !== file.items.length)
      throw new Error(`${sheet.slug}: ${String(file.items.length - used.size)} pieces in no glyph`);
  }
  out[font.name] = { classes, meshes, glyphs };
}

const json = JSON.stringify(out)
  .replace(/("[^"]{1,2}":\{"w")/g, "\n$1")
  .replace(/("glyphs":)/g, "\n$1");
writeFileSync(new URL("../lib/generators/piece-fonts.json", import.meta.url), json + "\n");
console.log(
  Object.entries(out)
    .map(([n, f]) => `${n}: ${Object.keys((f as { glyphs: object }).glyphs).join("")}`)
    .join("\n"),
);
