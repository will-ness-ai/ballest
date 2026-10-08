// pnpm lint (root): fails on a color literal in app/styles/ outside :root, where every
// color is a custom property (CODING_STANDARDS.md, "Site", which names the two literals
// allowed: ALLOWED below). It also fails on a font size in px, which ignores the reader's
// text size setting; the inputs' max(16px, 1rem) is the one allowed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "app", "styles");
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lch|lab|color)\([^)]*\)/gi;
/* translucent black or white for shadows and hairlines, and a player's own hue */
const ALLOWED = /^oklch\((?:0|100)% 0 none \/ (?:0?\.\d+|0|1)\)$|^hsla?\(var\(--h\)/;
/* a font-size, or the size in a font shorthand, written in px */
const PX_FONT = /^font(?:-size)?$/;
const PX = /\d+(?:\.\d+)?px/;
const INPUT_FONT = /^max\(16px,\s*1rem\)$/;

let bad = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".css"))) {
  /* comments become spaces, so every offset still points at its line */
  const css = readFileSync(join(DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, " "),
  );
  const line = (at) => css.slice(0, at).split("\n").length;
  /* each block's prelude, innermost last; a declaration is the text between ; { or } */
  const blocks = [];
  let start = 0;
  for (let i = 0; i <= css.length; i++) {
    const c = css[i];
    if (c !== ";" && c !== "{" && c !== "}" && i < css.length) continue;
    const text = css.slice(start, i);
    if (c === "{") blocks.push(text.trim());
    else {
      const m = /^\s*([-\w]+)\s*:([\s\S]*)$/.exec(text);
      if (m && !blocks.some((b) => /(^|[\s,]):root$/.test(b))) {
        const [, prop, value] = m;
        const at = start + text.search(/\S/);
        for (const c of value.matchAll(COLOR))
          if (!ALLOWED.test(c[0])) {
            const where = line(start + text.length - value.length + (c.index ?? 0));
            console.error(`web/app/styles/${file}:${where}: ${c[0]} (use a token on :root)`);
            bad++;
          }
        if (PX_FONT.test(prop) && PX.test(value) && !INPUT_FONT.test(value.trim())) {
          console.error(
            `web/app/styles/${file}:${line(at)}: font size in px (write calc(Nrem / 16))`,
          );
          bad++;
        }
      }
      if (c === "}") blocks.pop();
    }
    start = i + 1;
  }
}
if (bad) process.exit(1);
