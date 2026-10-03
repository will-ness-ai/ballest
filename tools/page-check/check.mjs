// The page's guardrail: index.html has no build step, so nothing else ever parses its
// script. Two checks, each reporting index.html line numbers:
//   - ESLint over the inline <script>: eslint's recommended rules (a name used but never
//     defined, a name declared twice, an unused one) plus the repo's best-practice set
//     (docs/linting.md). The root eslint.config.js cannot reach it: ESLint reads files.
//   - Every ${...} that lands in an href or src attribute goes through esc()
//     (CODING_STANDARDS.md, Page).
// Run: pnpm install (at the repo root, once), then node tools/page-check/check.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { ESLint } from "eslint";
import globals from "globals";

/* another copy of the page can be checked by path, e.g. an older revision */
const page = process.argv[2] || fileURLToPath(new URL("../../index.html", import.meta.url));
const html = readFileSync(page, "utf8");
const lineAt = i => html.slice(0, i).split("\n").length;
const problems = [];

/* the one inline script: the other <script> tag loads analytics by src */
const open = /<script>/.exec(html);
if (!open) throw new Error("no inline <script> in index.html");
const start = open.index + open[0].length, end = html.indexOf("</script>", start);
const offset = lineAt(start) - 1;
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    js.configs.recommended,
    {
      languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: globals.browser },
      rules: {
        eqeqeq: ["error", "always", { null: "ignore" }],
        "no-shadow": "error",
        "no-var": "error",
        "object-shorthand": "error",
        "prefer-const": "error",
      },
    },
  ],
});
const [result] = await eslint.lintText(html.slice(start, end));
for (const m of result.messages) problems.push(`index.html:${m.line + offset}: ${m.message}`);

/* the attribute rule: href="...${x}..." or src="${x}" with x not wrapped in esc() */
for (const m of html.matchAll(/\b(?:href|src)="[^"]*?\$\{(?!esc\()/g))
  problems.push(`index.html:${lineAt(m.index)}: an href or src interpolates without esc(): ${m[0]}`);

if (problems.length){ console.error(problems.join("\n")); process.exit(1); }
console.log("OK: index.html script lints clean, every href/src interpolation escaped");
