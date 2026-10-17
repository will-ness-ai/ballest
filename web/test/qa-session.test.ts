import { describe, expect, it } from "vitest";

import { sessionOf } from "../lib/auth";
import { HINT_COOKIE, SESSION_COOKIE } from "../lib/cookies";
import * as qa from "../scripts/qa/session.mjs";

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
