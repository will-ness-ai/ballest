// Signing the Activity's page in through Discord (src/activity/web/session.ts): a token from an
// earlier visit is reused, a stale one is replaced without bothering the member, and a 401 mid-
// session signs in again rather than leaving the page stuck.
import { describe, expect, it } from "vitest";
import {
  type DiscordClient,
  discordSession,
  type SavedToken,
  type SignedIn,
} from "../src/activity/web/session.js";

const GUILD = "g1";

const saved = (token: string | null = null): SavedToken & { value: string | null } => ({
  value: token,
  read() {
    return this.value;
  },
  write(t) {
    this.value = t;
  },
});

/** Discord, as the page's SDK sees it; `valid` are the tokens it accepts. */
const discord = (valid: ReadonlyArray<string>, guildId: string | null = GUILD) => {
  const calls: Array<string> = [];
  const client: DiscordClient = {
    guildId,
    ready: () => {
      calls.push("ready");
      return Promise.resolve();
    },
    authorize: () => {
      calls.push("authorize");
      return Promise.resolve(`code-${calls.length}`);
    },
    authenticate: (token) => {
      calls.push(`authenticate:${token}`);
      return valid.includes(token) ? Promise.resolve() : Promise.reject(new Error("bad token"));
    },
  };
  return { client, calls };
};

/** The bot's /api/token: every code becomes a fresh token. */
const exchange = (code: string) => Promise.resolve(`token-for-${code}`);

const token = (r: SignedIn | "wrongServer") => (r === "wrongServer" ? r : r.token());

describe("signing in through Discord", () => {
  it("authorizes, swaps the code at the bot, and keeps the token for next time", async () => {
    const d = discord(["token-for-code-2"]);
    const store = saved();
    const s = await discordSession(d.client, { guildIds: [GUILD], saved: store, exchange });
    expect(token(s)).toBe("token-for-code-2");
    expect(store.value).toBe("token-for-code-2");
    expect(d.calls).toEqual(["ready", "authorize", "authenticate:token-for-code-2"]);
  });

  it("reuses the token from an earlier visit without authorizing again", async () => {
    const d = discord(["kept"]);
    const s = await discordSession(d.client, { guildIds: [GUILD], saved: saved("kept"), exchange });
    expect(token(s)).toBe("kept");
    expect(d.calls).toEqual(["ready", "authenticate:kept"]);
  });

  it("replaces a token Discord no longer takes", async () => {
    const d = discord(["token-for-code-3"]);
    const store = saved("expired");
    const s = await discordSession(d.client, { guildIds: [GUILD], saved: store, exchange });
    expect(token(s)).toBe("token-for-code-3");
    expect(store.value).toBe("token-for-code-3");
  });

  it("says so when opened in a server Multiballs doesn't run in", async () => {
    const d = discord([], "elsewhere");
    const s = await discordSession(d.client, { guildIds: [GUILD], saved: saved(), exchange });
    expect(s).toBe("wrongServer");
    expect(d.calls).toEqual(["ready"]);
  });

  it("signs in again when the bot stops taking its token", async () => {
    const d = discord(["kept", "token-for-code-3"]);
    const store = saved("kept");
    const s = await discordSession(d.client, { guildIds: [GUILD], saved: store, exchange });
    if (s === "wrongServer") throw new Error("expected a session");
    await s.renew();
    expect(s.token()).toBe("token-for-code-3");
    expect(store.value).toBe("token-for-code-3");
  });

  it("asks Discord once when several requests are turned away together", async () => {
    const d = discord(["kept", "token-for-code-3"]);
    const s = await discordSession(d.client, { guildIds: [GUILD], saved: saved("kept"), exchange });
    if (s === "wrongServer") throw new Error("expected a session");
    await Promise.all([s.renew(), s.renew(), s.renew()]);
    expect(d.calls.filter((c) => c === "authorize")).toHaveLength(1);
  });
});
