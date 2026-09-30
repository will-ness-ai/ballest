// The page's guardrail: index.html has no build step, so nothing else ever parses its
// script. Two checks, each reporting index.html line numbers:
//   - ESLint over the inline <script>: a name used but never defined (a function removed
//     in one place and still called in another), and a name declared twice (the later
//     `function` silently replaces the earlier one).
//   - Every ${...} that lands in an href or src attribute goes through esc()
//     (CODING_STANDARDS.md, Page).
// Run: (cd tools/page-check && npm ci) && node tools/page-check/check.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  overrideConfig: {
    languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: globals.browser },
    rules: { "no-undef": "error", "no-redeclare": "error", "no-dupe-keys": "error" },
  },
});
const [result] = await eslint.lintText(html.slice(start, end));
for (const m of result.messages) problems.push(`index.html:${m.line + offset}: ${m.message}`);

/* the attribute rule: href="...${x}..." or src="${x}" with x not wrapped in esc() */
for (const m of html.matchAll(/\b(?:href|src)="[^"]*?\$\{(?!esc\()/g))
  problems.push(`index.html:${lineAt(m.index)}: an href or src interpolates without esc(): ${m[0]}`);

if (problems.length){ console.error(problems.join("\n")); process.exit(1); }
console.log("OK: index.html script lints clean, every href/src interpolation escaped");
