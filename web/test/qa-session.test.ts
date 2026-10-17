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
