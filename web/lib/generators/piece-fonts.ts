// The Sign's piece fonts: alphabets R23 built by hand from the editor's track pieces and
// uploaded as Prefabs, each glyph its own pieces (piece-fonts.json, written from those Prefabs
// by scripts/piece-fonts.ts). Where a drawn font becomes cells of blocks
// (lib/generator-letters.ts), a piece font places its glyphs' own pieces, scaled to fit, so a
// sign looks as R23 built it.
// A glyph stands as a sign does: reading along +Y, its front facing -X; its left edge is at
// y 0, its baseline at z 0 and its front at x 0, in the cm R23 built it at.
import type { PrefabItem } from "../prefab";
import type { Measure } from "../generator-letters";
import { placed, type Colour } from "./pieces";
import DATA from "./piece-fonts.json";

/* a piece: its class's and mesh's places in the font's lists, its mesh's material slots, then
   its location, rotation and scale, nine numbers */
type Piece = Array<number>;
export interface Glyph {
  /* its width, how far it reaches above the baseline and below it, in cm */
  w: number;
  top: number;
  low: number;
  pieces: Array<Piece>;
}
export interface PieceFont {
  classes: Array<string>;
  meshes: Array<string>;
  glyphs: Record<string, Glyph>;
}

/* each font: the one case its alphabet is in, who built it and the Prefabs it comes from */
export const PIECE_FONT_INFO = {
  Graduate: {
    letterCase: "upper",
    by: "R23",
    prefabs: [
      { slug: "graduate-alphabet", name: "Graduate Alphabet" },
      { slug: "graduatenumberssymbols", name: "Graduate Numbers & Symbols" },
    ],
  },
  Leker: {
    letterCase: "lower",
    by: "R23",
    prefabs: [
      { slug: "leker-alphabet", name: "Leker Alphabet" },
      { slug: "leker-numbers-symbols", name: "Leker Numbers & Symbols" },
    ],
  },
} as const;
export type PieceFontName = keyof typeof PIECE_FONT_INFO;
export const PIECE_FONTS = DATA as Record<PieceFontName, PieceFont>;
export const isPieceFont = (font: unknown): font is PieceFontName =>
  typeof font === "string" && Object.hasOwn(PIECE_FONT_INFO, font);

/* the gap between letters and a space's width, as parts of a capital's height */
const TRACKING = 0.12;
const SPACE = 0.4;
/* a line's step down, as parts of the tallest letter over the deepest */
const LEADING = 1.15;

export interface PieceLettering extends Measure {
  /* the lines, one under another and each centred on y 0, `scale` times the size R23 built
     them, the last line's lowest reach at z 0 and their front at x 0, in `colour` */
  pieces: (lines: Array<string>, scale: number, colour: Colour) => Array<PrefabItem>;
}

export function pieceLettering(name: PieceFontName): PieceLettering {
  const font = PIECE_FONTS[name];
  const { glyphs } = font;
  const { letterCase } = PIECE_FONT_INFO[name];
  const cap = glyphs[letterCase === "upper" ? "H" : "h"].top;
  const ascent = Math.max(...Object.values(glyphs).map((g) => g.top));
  const descent = Math.max(...Object.values(glyphs).map((g) => g.low));
  const lineHeight = (ascent + descent) * LEADING;
  const gap = cap * TRACKING;

  /* the glyph each character is drawn with (null for a space): a straight double quote opens
     after a space, a bracket or another opening quote and closes otherwise, and a character it
     has no glyph for is a ? */
  const glyphsOf = (line: string) =>
    Array.from(line).map((ch, i, all) => {
      if (/\s/.test(ch)) return null;
      const quote = ch === '"' ? (i === 0 || /[\s([“]/.test(all[i - 1]) ? "“" : "”") : ch;
      return glyphs[quote] ?? glyphs["?"];
    });
  /* where each glyph starts, and the line's width */
  const layout = (line: string) => {
    const gs = glyphsOf(line);
    const at: Array<number> = [];
    let pen = 0;
    gs.forEach((g, i) => {
      at.push(pen);
      pen += (g ? g.w : cap * SPACE) + (i < gs.length - 1 ? gap : 0);
    });
    return { gs, at, width: pen };
  };

  return {
    letterCase,
    width: (line) => layout(line).width,
    lineHeight,
    pieces: (lines, scale, colour) =>
      lines.flatMap((line, li) => {
        const { gs, at, width } = layout(line);
        const base = descent + (lines.length - 1 - li) * lineHeight;
        return gs.flatMap((g, gi) =>
          (g?.pieces ?? []).map(([cls, mesh, slots, x, y, z, pitch, yaw, roll, sx, sy, sz]) =>
            placed(
              font.classes[cls],
              font.meshes[mesh],
              slots,
              colour,
              [x * scale, (at[gi] + y - width / 2) * scale, (base + z) * scale],
              [pitch, yaw, roll],
              [sx * scale, sy * scale, sz * scale],
            ),
          ),
        );
      }),
  };
}
