// Signing the Activity's page in through Discord (src/activity/web/session.ts): a 401 mid-session
// signs in again rather than leaving the page stuck.
import { describe, expect, it } from "vitest";
import { type DiscordClient, discordSession, type SignedIn } from "../src/activity/web/session.js";

const GUILD = "g1";

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
  it("authorizes, swaps the code at the bot, and tells Discord who the page acts for", async () => {
    const d = discord(["token-for-code-2"]);
    const s = await discordSession(d.client, { guildIds: [GUILD], exchange });
    expect(token(s)).toBe("token-for-code-2");
    expect(d.calls).toEqual(["ready", "authorize", "authenticate:token-for-code-2"]);
  });

  it("says so when opened in a server Multiballs doesn't run in", async () => {
    const d = discord([], "elsewhere");
    const s = await discordSession(d.client, { guildIds: [GUILD], exchange });
    expect(s).toBe("wrongServer");
    expect(d.calls).toEqual(["ready"]);
  });

  it("signs in again when the bot stops taking its token", async () => {
    const d = discord(["token-for-code-2", "token-for-code-4"]);
    const s = await discordSession(d.client, { guildIds: [GUILD], exchange });
    if (s === "wrongServer") throw new Error("expected a session");
    await s.renew();
    expect(s.token()).toBe("token-for-code-4");
  });

  it("asks Discord once when several requests are turned away together", async () => {
    const d = discord(["token-for-code-2", "token-for-code-4"]);
    const s = await discordSession(d.client, { guildIds: [GUILD], exchange });
    if (s === "wrongServer") throw new Error("expected a session");
    const authorizes = () => d.calls.filter((c) => c === "authorize").length;
    const before = authorizes();
    await Promise.all([s.renew(), s.renew(), s.renew()]);
    expect(authorizes() - before).toBe(1);
  });

  it("is accepted in any running Venue's server, and keeps that server for every request", async () => {
    const d = discord(["token-for-code-2"], "g2");
    const s = await discordSession(d.client, { guildIds: [GUILD, "g2"], exchange });
    if (s === "wrongServer") throw new Error("expected a session");
    expect(s.guild).toBe("g2");
  });
});
