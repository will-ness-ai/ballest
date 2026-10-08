// pnpm lint (root): fails on a color literal in app/styles/ outside :root, where every
// color is a custom property (CODING_STANDARDS.md, "Site"). Two literals are allowed:
// translucent black or white, for shadows and hairlines, and a player's own hue,
// hsl(var(--h) ...).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "app", "styles");
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/gi;
const ALLOWED =
  /^rgba\(\s*(?:0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\s*,\s*[\d.]+\s*\)$|^hsla?\(var\(--h\)/;

let bad = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".css"))) {
  const lines = readFileSync(join(DIR, file), "utf8").split("\n");
  let inRoot = false,
    depth = 0,
    inComment = false;
  lines.forEach((line, i) => {
    let code = line;
    if (inComment) {
      const end = code.indexOf("*/");
      if (end < 0) return;
      code = code.slice(end + 2);
      inComment = false;
    }
    code = code.replace(/\/\*.*?\*\//g, "");
    if (code.includes("/*")) {
      code = code.slice(0, code.indexOf("/*"));
      inComment = true;
    }
    if (!inRoot && /(^|[\s,]):root\s*\{/.test(code)) {
      inRoot = true;
      depth = 0;
    }
    /* a value: what follows a property's colon, never a selector (`#add {` is an id) */
    const value = /^[^{]*?:(?!:)([^{]*)$/.exec(code)?.[1] ?? "";
    if (!inRoot)
      for (const m of value.matchAll(COLOR))
        if (!ALLOWED.test(m[0])) {
          console.error(`web/app/styles/${file}:${String(i + 1)}: ${m[0]} (use a token on :root)`);
          bad++;
        }
    if (inRoot) {
      depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
      if (depth <= 0) inRoot = false;
    }
  });
}
if (bad) process.exit(1);
