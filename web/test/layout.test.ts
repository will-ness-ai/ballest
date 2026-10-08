// desktop.css and the code that asks matchMedia which layout is showing name the same width.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import { WIDE } from "../lib/layout";

test("desktop.css switches layout at WIDE", () => {
  const css = readFileSync(new URL("../app/styles/desktop.css", import.meta.url), "utf8");
  const queries = [...css.matchAll(/@media\s+([^{]+?)\s*\{/g)].map((m) => m[1]);
  expect(queries[0]).toBe(WIDE);
});
