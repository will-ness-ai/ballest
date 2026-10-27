// The Activity page's API client (src/activity/web/client.ts): every request names the Venue's
// server the page was opened in, so the API serves that Venue (GUILD_HEADER), even after it signs
// in again.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeClient } from "../src/activity/web/client.js";
import { fixedSession, type SignedIn } from "../src/activity/web/session.js";
import { GUILD_HEADER } from "../src/domain.js";

/** Stand in for fetch: each answer in turn, and every request's headers. */
const fakeFetch = (statuses: ReadonlyArray<number>) => {
  const sent: Array<Record<string, string>> = [];
  let call = 0;
  vi.stubGlobal("fetch", (_path: string, init: RequestInit) => {
    sent.push({ ...(init.headers as Record<string, string>) });
    const status = statuses[Math.min(call++, statuses.length - 1)] ?? 200;
    return Promise.resolve(new Response(JSON.stringify({ players: [] }), { status }));
  });
  return sent;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the page's requests", () => {
  it("name the Venue's server the page was opened in", async () => {
    const sent = fakeFetch([200]);
    await makeClient(fixedSession("dev-x", "g2")).players();
    expect(sent[0]?.[GUILD_HEADER]).toBe("g2");
    expect(sent[0]?.authorization).toBe("Bearer dev-x");
  });

  it("still name it when repeated after signing in again", async () => {
    const sent = fakeFetch([401, 200]);
    let token = "old";
    const session: SignedIn = {
      guild: "g2",
      token: () => token,
      renew: () => {
        token = "new";
        return Promise.resolve();
      },
    };
    await makeClient(session).players();
    expect(sent.map((h) => [h[GUILD_HEADER], h.authorization])).toEqual([
      ["g2", "Bearer old"],
      ["g2", "Bearer new"],
    ]);
  });
});
