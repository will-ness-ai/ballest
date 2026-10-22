// The Stats Link's site side (db/stats-link.ts) against a throwaway database: what the link page
// /discord/link?t=<token> says for a link request Multiballs wrote, and the confirm POST that
// pairs the Discord account with the signed-in Steam ID.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { confirmLink, linkPageOf, type StatsLinkDeps } from "../db/stats-link";
import { freshDb } from "./pg";
import { ENV, NOW, SITE, signIn } from "./session";

const ADA = "76561199000000021";
const BO = "76561199000000022";
const DISCORD = "300000000000000001";
const TOKEN = "0123456789abcdef0123456789abcdef";
const MINUTE = 60_000;

let t: Awaited<ReturnType<typeof freshDb>>;
let clock: number;
const deps = (): StatsLinkDeps => ({
  db: t.db,
  auth: { ...ENV, now: clock },
  persona: (id) => Promise.resolve(id === BO ? "Bo from Steam" : null),
});

beforeAll(async () => {
  t = await freshDb();
  await t.db.$client.query(`insert into players (steam_id, persona) values ('${ADA}', 'Ada')`);
});
afterAll(() => t.drop());
beforeEach(async () => {
  clock = NOW;
  await t.db.$client.query("delete from stats_links; delete from stats_link_requests");
});

/* a press of See my stats with no Stats Link, as Multiballs writes it, `ago` ms before now */
async function requested(token = TOKEN, ago = 0, discord = DISCORD, name = "ada.disc") {
  await t.db.$client.query(
    "insert into stats_link_requests (token, discord_id, discord_name, created_at) values ($1, $2, $3, $4)",
    [token, discord, name, new Date(clock - ago)],
  );
}

/* the Steam ID each Discord account is paired with */
async function links(): Promise<Record<string, string>> {
  const { rows } = await t.db.$client.query<{ discord_id: string; steam_id: string }>(
    "select discord_id, steam_id from stats_links",
  );
  return Object.fromEntries(rows.map((r) => [r.discord_id, r.steam_id]));
}

/* the confirm button's POST, signed in as `id` (or signed out) */
async function confirm(token: string, id: string | null, headers: Record<string, string> = {}) {
  const cookie = id ? `ballest-session=${(await signIn(id)).session}` : "";
  return confirmLink(
    new Request(`${SITE}/api/discord/link?t=${token}`, {
      method: "POST",
      headers: { cookie, origin: SITE, ...headers },
    }),
    deps(),
  );
}

describe("the link page", () => {
  test("a token nobody wrote, or none at all, says so", async () => {
    expect(await linkPageOf(deps(), TOKEN, ADA)).toEqual({ state: "bad" });
    expect(await linkPageOf(deps(), null, ADA)).toEqual({ state: "bad" });
    expect(await linkPageOf(deps(), "x".repeat(500), null)).toEqual({ state: "bad" });
  });

  test("signed out, it names the Discord account and offers Sign in", async () => {
    await requested();
    expect(await linkPageOf(deps(), TOKEN, null)).toEqual({
      state: "signed-out",
      discord: "ada.disc",
    });
  });

  test("signed in, it asks to pair the Discord account with the player's name", async () => {
    await requested();
    expect(await linkPageOf(deps(), TOKEN, ADA)).toEqual({
      state: "confirm",
      discord: "ada.disc",
      steamId: ADA,
      persona: "Ada",
    });
  });

  test("a player on no board is named by their Steam persona, else their Steam ID", async () => {
    await requested();
    expect(await linkPageOf(deps(), TOKEN, BO)).toMatchObject({ persona: "Bo from Steam" });
    const nobody = "76561199000000023";
    expect(await linkPageOf(deps(), TOKEN, nobody)).toMatchObject({ persona: nobody });
  });

  test("a request older than 15 minutes has expired", async () => {
    await requested(TOKEN, 15 * MINUTE + 1);
    expect(await linkPageOf(deps(), TOKEN, ADA)).toEqual({ state: "expired" });
    expect(await linkPageOf(deps(), TOKEN, null)).toEqual({ state: "expired" });
  });
});

describe("confirming", () => {
  test("pairs the Discord account with the signed-in Steam ID and marks the request used", async () => {
    await requested();
    const r = await confirm(TOKEN, ADA);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`/discord/link?t=${TOKEN}`);
    expect(await links()).toEqual({ [DISCORD]: ADA });
    expect(await linkPageOf(deps(), TOKEN, ADA)).toEqual({ state: "done" });
    const { rows } = await t.db.$client.query<{ used_at: Date }>(
      "select used_at from stats_link_requests",
    );
    expect(rows[0].used_at).toEqual(new Date(NOW));
  });

  test("a second confirm is refused: the request is used", async () => {
    await requested();
    await confirm(TOKEN, ADA);
    const r = await confirm(TOKEN, BO);
    expect(r.status).toBe(303);
    expect(await links()).toEqual({ [DISCORD]: ADA });
    expect(await linkPageOf(deps(), TOKEN, BO)).toEqual({ state: "used" });
  });

  test("pairing again replaces the Stats Link", async () => {
    await requested();
    await confirm(TOKEN, ADA);
    const again = "fedcba9876543210fedcba9876543210";
    clock += MINUTE;
    await requested(again);
    await confirm(again, BO);
    expect(await links()).toEqual({ [DISCORD]: BO });
    /* the first request's reader no longer holds the pairing it made */
    expect(await linkPageOf(deps(), TOKEN, ADA)).toEqual({ state: "used" });
    expect(await linkPageOf(deps(), again, BO)).toEqual({ state: "done" });
  });

  test("signed out, a bad token or an expired request, nothing is paired", async () => {
    await requested();
    await requested("a".repeat(32), 16 * MINUTE);
    expect((await confirm(TOKEN, null)).status).toBe(303);
    expect((await confirm(TOKEN.replace("0", "f"), ADA)).status).toBe(303);
    expect((await confirm("a".repeat(32), ADA)).status).toBe(303);
    expect(await links()).toEqual({});
    expect(await linkPageOf(deps(), TOKEN, ADA)).toMatchObject({ state: "confirm" });
  });

  test("from another site, nothing is paired", async () => {
    await requested();
    const r = await confirm(TOKEN, ADA, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    const fetched = await confirm(TOKEN, ADA, { origin: "", "sec-fetch-site": "cross-site" });
    expect(fetched.status).toBe(403);
    expect(await links()).toEqual({});
  });

  test("prunes the requests older than 15 minutes", async () => {
    await requested("b".repeat(32), 15 * MINUTE + 1, "300000000000000002");
    await requested("c".repeat(32), 14 * MINUTE, "300000000000000003");
    await requested();
    await confirm(TOKEN, ADA);
    const { rows } = await t.db.$client.query<{ token: string }>(
      "select token from stats_link_requests order by token",
    );
    expect(rows.map((r) => r.token)).toEqual([TOKEN, "c".repeat(32)]);
  });
});
