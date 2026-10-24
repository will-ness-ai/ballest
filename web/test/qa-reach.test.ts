import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { changedFiles, reach } from "../scripts/qa/reach.mjs";

// qa check's default: the catalogue pages a branch's changed files can reach, read from the
// repo's own files, so a page that stops importing a file stops being drawn for it.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const of = (changed: Array<string>) => reach(changed, ROOT);

describe("reach", () => {
  it("draws nothing for docs, tests and the bot", () => {
    expect(of(["docs/site.md", "web/test/nav.test.ts", "discord-bot/src/main.ts"])).toEqual({
      all: null,
      pages: [],
      routes: [],
    });
  });

  it("draws nothing for tooling: lint and test config", () => {
    expect(of(["eslint.config.js", "web/vitest.config.ts", ".gitignore"])).toEqual({
      all: null,
      pages: [],
      routes: [],
    });
  });

  it("draws everything for qa's own catalogue, which decides what is drawn", () => {
    expect(of(["web/scripts/qa/catalogue.mjs"]).all).toBe("web/scripts/qa/catalogue.mjs");
  });

  it("follows a library file's imports up to the pages that use it", () => {
    const r = of(["web/lib/generators/signs.ts"]);
    expect(r.all).toBeNull();
    expect(r.pages).toEqual([{ name: "prefabs-make", via: "web/lib/generators/signs.ts" }]);
  });

  it("names a page the catalogue doesn't draw, as a gap", () => {
    expect(of(["web/lib/generators/signs.ts"]).routes).toContain(
      "web/app/prefabs/make/[generator]/page.tsx",
    );
  });

  it("matches a page's file to the catalogue paths it serves", () => {
    expect(of(["web/app/daily/standings/page.tsx"]).pages.map((p) => p.name)).toEqual([
      "daily-standings",
    ]);
    expect(of(["web/app/vs/[a]/[b]/page.tsx"]).pages.map((p) => p.name)).toEqual(["vs"]);
  });

  it("draws everything for the root layout and the proxy, which every page goes through", () => {
    expect(of(["web/app/layout.tsx"]).all).toBe("web/app/layout.tsx");
    expect(of(["web/proxy.ts"]).all).toBe("web/proxy.ts");
  });

  it("draws everything for a site file no page imports, such as an API route", () => {
    expect(of(["web/app/api/me/route.ts"]).all).toBe("web/app/api/me/route.ts");
  });
});

describe("changedFiles", () => {
  /* a repo whose main holds `files`, with `change` run on a branch from it */
  function branch(
    files: Record<string, string>,
    change: (git: (...a: Array<string>) => void, dir: string) => void,
  ) {
    const dir = mkdtempSync(join(tmpdir(), "qa-reach-"));
    const git = (...a: Array<string>) => {
      execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", ...a], { stdio: "pipe" });
    };
    git("-c", "init.defaultBranch=main", "init", "-q");
    git("config", "user.email", "qa@example.invalid");
    git("config", "user.name", "qa");
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), text);
    }
    git("add", "-A");
    git("commit", "-qm", "main");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-qb", "topic");
    change(git, dir);
    git("commit", "-qam", "topic");
    try {
      return { upTo: changedFiles(dir, { at: "HEAD" }).sort(), tree: changedFiles(dir).sort() };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("gives a renamed page's old path too, which now answers 404", () => {
    const moved = branch({ "web/app/maps/page.tsx": "export default 1;\n" }, (git) => {
      git("mv", "web/app/maps", "web/app/workshop");
    });
    expect(moved.upTo).toEqual(["web/app/maps/page.tsx", "web/app/workshop/page.tsx"]);
  });

  it("leaves out a deleted module whose importer changed, but keeps one nothing imported", () => {
    const files = {
      "web/lib/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
      "web/lib/b.ts": "export const b = 1;\n",
      "web/proxy.ts": "export function proxy() {}\n",
    };
    const gone = branch(files, (git, dir) => {
      writeFileSync(join(dir, "web/lib/a.ts"), "export const a = 1;\n");
      git("rm", "-q", "web/lib/b.ts", "web/proxy.ts");
    });
    expect(gone.upTo).toEqual(["web/lib/a.ts", "web/proxy.ts"]);
  });

  it("holds a new file only up to the working tree, as a commit can't", () => {
    const made = branch({ "web/lib/a.ts": "export const a = 1;\n" }, (git, dir) => {
      writeFileSync(join(dir, "web/lib/a.ts"), "export const a = 2;\n");
      writeFileSync(join(dir, "web/lib/new.ts"), "export const n = 1;\n");
    });
    expect(made.upTo).toEqual(["web/lib/a.ts"]);
    expect(made.tree).toEqual(["web/lib/a.ts", "web/lib/new.ts"]);
  });
});
