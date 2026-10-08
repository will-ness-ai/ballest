// One config for every JS and TS file in the repo (docs/linting.md). TypeScript gets
// typescript-eslint's strict and stylistic type-checked sets, each file typed by the
// tsconfig nearest to it (discord-bot/, web/); plain JS gets the same rules minus the
// ones that need types. Formatting is Prettier's, so eslint-config-prettier goes last.
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

import noClientValues from "./web/eslint/no-client-values.js";

export default defineConfig(
  globalIgnores([
    "**/node_modules/",
    "data/",
    "leth/",
    ".claude/skills/",
    ".claude/worktrees/",
    "discord-bot/.logs/",
    "web/.next/",
    "web/public/",
    "web/next-env.d.ts",
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    rules: {
      // the bot is Effect code, which spells arrays ReadonlyArray<T> / Array<T> throughout
      "@typescript-eslint/array-type": ["error", { default: "generic" }],
      // a number in a template literal prints as itself; only objects and nullish are bugs
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // the Activity's action handlers end on `return render();`, which says what they do last
      "@typescript-eslint/no-confusing-void-expression": "off",
      // `while (true)` is how the Effect generators poll
      "@typescript-eslint/no-unnecessary-condition": [
        "error",
        { allowConstantLoopConditions: "only-allowed-literals" },
      ],
    },
  },
  {
    // tests read JSON bodies and fakes back as they come, and assert on their shape
    files: ["discord-bot/test/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["web/**/*.{ts,tsx}"],
    extends: [nextPlugin.configs["core-web-vitals"], reactHooks.configs.flat.recommended],
    settings: { next: { rootDir: "web/" } },
    plugins: { site: { rules: { "no-client-values": noClientValues } } },
    rules: {
      "site/no-client-values": "error",
      // the pictures are Steam's (avatars, Workshop previews) and the Circuit screenshots,
      // sized by the stylesheet the single-page site had; next/image would change the markup
      "@next/next/no-img-element": "off",
    },
  },
  {
    // lib/ is pure: no React, no Next and no database (CODING_STANDARDS.md, "Site")
    files: ["web/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["react", "react-dom", "next", "next/*", "**/db/*", "**/db"] },
      ],
    },
  },
  {
    // a test renders client code in the browser (happy-dom), never as a server component
    files: ["web/test/**"],
    rules: { "site/no-client-values": "off" },
  },
  prettier,
);
