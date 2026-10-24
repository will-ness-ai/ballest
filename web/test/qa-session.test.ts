import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seed } from "../db/seed/harness";
import { prefabs } from "../db/schema";

import { sessionOf } from "../lib/auth";
import { HINT_COOKIE, SESSION_COOKIE } from "../lib/cookies";
import { ADMIN_STEAM_ID } from "../lib/prefabs";
import { IDS } from "../scripts/qa/catalogue.mjs";
import * as qa from "../scripts/qa/session.mjs";
import { freshDb } from "./pg";

// qa signs a browser in by writing the session cookie itself (scripts/qa/session.mjs), so
// it draws the pages a player sees signed in. These keep its cookie to the one lib/auth.ts
// accepts.
const ID = "76561199000000001";
const request = (value: string) =>
  new Request("http://localhost/", { headers: { cookie: `${SESSION_COOKIE}=${value}` } });

describe("qa's session cookie", () => {
  it("signs the browser in as the player it names", () => {
    const now = Date.now();
    const value = qa.sessionCookie(ID, "qa-secret", now);
    expect(sessionOf(request(value), { secret: "qa-secret", now })).toBe(ID);
  });

  it("is refused under another secret", () => {
    const now = Date.now();
    const value = qa.sessionCookie(ID, "qa-secret", now);
    expect(sessionOf(request(value), { secret: "other", now })).toBeNull();
  });

  it("goes by the site's own cookie names", () => {
    const names = qa.signedIn("http://localhost:3000", ID, "qa-secret", 0).map((c) => c.name);
    expect(names).toEqual([SESSION_COOKIE, HINT_COOKIE]);
  });
});

describe("the players qa signs in as", () => {
  let t: Awaited<ReturnType<typeof freshDb>>;
  beforeAll(async () => {
    t = await freshDb();
    await seed(t.db, "stress");
  });
  afterAll(() => t.drop());

  it("are the Prefab admin and the stress Prefab's uploader", async () => {
    expect(IDS.stress.ADMIN).toBe(ADMIN_STEAM_ID);
    const [prefab] = await t.db
      .select({ uploader: prefabs.uploader })
      .from(prefabs)
      .where(eq(prefabs.slug, IDS.stress.PREFAB));
    expect(prefab.uploader).toBe(IDS.stress.UPLOADER);
  });
});

describe("a local build's secret", () => {
  const dirs: Array<string> = [];
  /* a web/ folder holding these .env files */
  const web = (files: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "qa-secret-"));
    dirs.push(dir);
    for (const [name, secret] of Object.entries(files))
      writeFileSync(join(dir, name), `SESSION_SECRET=${secret}\n`);
    return dir;
  };
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true });
  });

  it("falls back to qa-only, the one pnpm serve and CI build with, and says so", () => {
    expect(qa.localSecret({}, web())).toEqual({ secret: "qa-only", fallback: true });
  });

  it("is the environment's, then the .env files' in the order Next reads them", () => {
    const dir = web({ ".env": "from-env", ".env.local": '"from-local"' });
    expect(qa.localSecret({}, dir)).toEqual({ secret: "from-local", fallback: false });
    expect(qa.localSecret({ SESSION_SECRET: "from-shell" }, dir).secret).toBe("from-shell");
    expect(qa.localSecret({}, web({ ".env": "from-env" })).secret).toBe("from-env");
  });

  it("is configured by a mode's own files, and only for that mode", () => {
    const dir = web({ ".env.production": "prod", ".env.development.local": "dev" });
    expect(qa.configuredSecret({}, dir, "production")).toBe("prod");
    expect(qa.configuredSecret({}, dir, "development")).toBe("dev");
    expect(qa.configuredSecret({}, web({ ".env.development": "dev" }), "production")).toBeNull();
    expect(qa.localSecret({}, web({ ".env.production.local": "p" }))).toEqual({
      secret: "p",
      fallback: false,
    });
  });

  it("is configured nowhere when no file or the environment sets one", () => {
    expect(qa.configuredSecret({}, web(), "production")).toBeNull();
    expect(qa.configuredSecret({ SESSION_SECRET: " " }, web(), "development")).toBeNull();
  });
});

describe("signIn", () => {
  const local = { url: "http://localhost:3000", ids: "stress", secret: "qa-secret" };

  it("signs a page in as its player where the target's secret is known", () => {
    expect(qa.signIn("prefab-admin", local, 0)?.as).toBe(ADMIN_STEAM_ID);
    expect(qa.signIn("prefab-admin", { ...local, secret: null }, 0)).toBeNull();
    expect(qa.signIn("prefab-admin", { ...local, ids: "real" }, 0)).toBeNull();
  });

  it("leaves a page drawn signed out alone", () => {
    expect(qa.signIn("home", { ...local, secret: null }, 0)).toEqual({
      as: undefined,
      cookies: [],
    });
  });
});
