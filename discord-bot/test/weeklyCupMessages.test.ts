// The Weekly Cup's messages (spec #353): its post, Shortlist, standings, results and notices.
import {
  type ActionRowBuilder,
  type AttachmentBuilder,
  type ButtonBuilder,
  MessageFlags,
} from "discord.js";
import { describe, expect, it } from "vitest";
import { parseControl } from "../src/discord/controls.js";
import type { Payload } from "../src/discord/messages.js";
import {
  cupConfirmSkipMessage,
  cupNoticeMessage,
  cupResultsMessages,
  cupStandingsClosedMessage,
  cupStandingsImage,
  cupStandingsMessage,
  shortlistMessage,
  weeklyCupMessage,
} from "../src/weeklyCup/messages.js";
import type { CupMap, CupState, StandingsView } from "../src/weeklyCup/model.js";
import { cupStandings } from "../src/weeklyCup/points.js";
import { sentOnce } from "../src/weeklyCup/slots.js";
import { weekAt } from "../src/weeklyCup/week.js";
import { ticks } from "./harness.js";

/** Each button's label and what it does. */
const buttons = (p: Payload) =>
  (p.components ?? [])
    .flatMap((row) => (row as ActionRowBuilder<ButtonBuilder>).toJSON().components)
    .map((b) => ({
      label: "label" in b ? b.label : undefined,
      does: "custom_id" in b ? parseControl(b.custom_id) : "url" in b ? b.url : null,
    }));
/** The users a message may ping. */
const pinged = (p: Payload) => p.allowedMentions?.users ?? [];
const pingsNobody = (p: Payload) => expect(p.allowedMentions).toEqual({ parse: [] });

describe("the Weekly Cup's post", () => {
  const week = weekAt(Date.parse("2026-10-27T15:00:00Z"));
  const post = (state: CupState, entrants: ReadonlyArray<string> = []) =>
    weeklyCupMessage({ guildId: "g-racing", week, state, entrants });
  /** Each button's label and what it does: Components V2 puts the rows inside the container. */
  const cupButtons = (p: Payload) =>
    [...JSON.stringify(p.components).matchAll(/"custom_id":"([^"]+)","label":"([^"]+)"/g)].map(
      ([, id, label]) => ({ label, does: parseControl(id ?? "") }),
    );
  const words = (p: Payload) => JSON.stringify(p.components);
  const cup = { guildId: "g-racing", week: "2026-10-26" };
  /** A real server id: the longest a nonce has to fit. */
  const GUILD = "1552729776165486602";

  it("offers Sign up, Withdraw and Skip while open, each for its server's week", () => {
    const open = post("open");
    expect(open.flags).toBe(MessageFlags.IsComponentsV2);
    expect(cupButtons(open)).toEqual([
      { label: "Sign up", does: { _tag: "CupSignUp", ...cup } },
      { label: "Withdraw", does: { _tag: "CupWithdraw", ...cup } },
      { label: "Skip this week", does: { _tag: "CupSkip", ...cup } },
    ]);
    pingsNobody(open);
  });

  it("writes the rules and every boundary, in each reader's own time", () => {
    const text = words(post("open"));
    expect(text).toContain("30 minutes");
    expect(text).toContain("no Ghosts");
    expect(text).toContain("honour system");
    expect(text).toContain("Only times set once racing opens count");
    for (const at of [week.shortlistAt, week.voteClosesAt, week.endsAt])
      expect(text).toContain(`<t:${at / 1000}:F>`);
  });

  it("names its Entrants without pinging them", () => {
    expect(words(post("open"))).toContain("No Entrants yet");
    const two = post("open", ["111", "222"]);
    expect(words(two)).toContain("**2 Entrants:** <@111>, <@222>");
    pingsNobody(two);
  });

  it("keeps sign-up open once the week is under way, without Skip", () => {
    for (const state of ["voting", "racing"] as const)
      expect(cupButtons(post(state)).map((b) => b.label)).toEqual(["Sign up", "Withdraw"]);
  });

  it("trims a skipped week's post to the skipped notice, without schedule, rules or Entrants", () => {
    const text = words(post("skipped", ["111"]));
    expect(text).toContain("Weekly Cup · week of");
    expect(text).toContain("Skipped this week");
    expect(text).not.toContain("This week** (US Central)");
    expect(text).not.toContain("The rules");
    expect(text).not.toContain("<@111>");
  });

  it("has no buttons once the week is over, cancelled or skipped, and says which", () => {
    expect(cupButtons(post("final"))).toEqual([]);
    expect(words(post("final"))).toContain("Sign-up is closed");
    expect(cupButtons(post("cancelled"))).toEqual([]);
    expect(words(post("cancelled"))).toContain("This week's Cup is cancelled");
    expect(cupButtons(post("skipped"))).toEqual([]);
    expect(words(post("skipped"))).toContain("Skipped this week");
  });

  it("pings the week's Entrants when it is cancelled or skipped", () => {
    const cancelled = cupNoticeMessage({
      _tag: "Cancelled",
      reason: "entrants",
      week: cup.week,
      entrants: ["111"],
    });
    expect(cancelled.content).toContain("<@111>");
    expect(cancelled.content).toContain("cancelled: fewer than 2 Players signed up");
    expect(pinged(cancelled)).toEqual(["111"]);
    const noMaps = cupNoticeMessage({
      _tag: "Cancelled",
      reason: "maps",
      week: cup.week,
      entrants: ["111", "222"],
    });
    expect(noMaps.content).toContain("no Map that none of its Entrants has Played");
    expect(pinged(noMaps)).toEqual(["111", "222"]);
    const skipped = cupNoticeMessage({ _tag: "Skipped", week: cup.week, entrants: ["1", "2"] });
    expect(skipped.content).toContain("skipped");
    expect(pinged(skipped)).toEqual(["1", "2"]);
  });

  const cupMap = (n: number): CupMap => ({
    pfid: `pf${n}`,
    title: `Map ${n}`,
    creator: "pebblewright",
    previewUrl: `https://example.invalid/${n}.jpg`,
    authorSeconds: 20.5,
    boardId: 100 + n,
    worldRecordTicks: ticks(15),
  });
  const shortlist = (n: number, pictures = true) =>
    shortlistMessage({
      guildId: cup.guildId,
      week,
      wanted: 10,
      closed: false,
      maps: Array.from({ length: n }, (_, i) => ({
        map: cupMap(i + 1),
        picture: pictures ? { type: "image/jpeg", body: new Uint8Array([i]) } : null,
      })),
    });

  it("posts the Shortlist with each Map's picture, name, author time and page", () => {
    const list = shortlist(10);
    expect(list.flags).toBe(MessageFlags.IsComponentsV2);
    const text = words(list);
    for (let n = 1; n <= 10; n++) {
      expect(text).toContain(`[Map ${n}](<https://ballestrecords.com/map/pf${n}>)`);
      expect(text).toContain(`attachment://map-${n}.jpg`);
    }
    expect(text).toContain("by pebblewright · author **0:20.500**");
    expect(text).toContain(`<t:${week.voteClosesAt / 1000}:F>`);
    expect(text).not.toContain("the Shortlist is shorter");
    expect((list.files ?? []).length).toBe(10);
    pingsNobody(list);
  });

  it("puts a vote for up to 3 of its Maps under the Shortlist", () => {
    const select = JSON.parse(words(shortlist(10))).flatMap((c: { components?: Array<unknown> }) =>
      (c.components ?? []).flatMap((r) => (r as { components?: Array<unknown> }).components ?? []),
    ) as Array<{
      custom_id?: string;
      max_values?: number;
      min_values?: number;
      options?: Array<{ label: string; value: string }>;
    }>;
    const vote = select.find((c) => c.custom_id !== undefined);
    expect(parseControl(vote?.custom_id ?? "")).toEqual({ _tag: "CupVote", ...cup });
    expect(vote).toMatchObject({ min_values: 1, max_values: 3 });
    expect(vote?.options).toHaveLength(10);
    expect(vote?.options?.[0]).toMatchObject({ label: "Map 1", value: "pf1" });
  });

  it("says when the Shortlist is short, and lets fewer be picked when fewer than 3", () => {
    const two = shortlist(2, false);
    expect(words(two)).toContain("Only 2 Maps fit this week");
    expect(words(two)).toContain('"max_values":2');
    expect(two.files ?? []).toEqual([]);
  });

  it("announces the Cup Maps with their votes and pages, pinging the Entrants", () => {
    const maps = [
      { map: cupMap(3), votes: 4 },
      { map: cupMap(1), votes: 2 },
      { map: cupMap(7), votes: 2 },
    ];
    const told = cupNoticeMessage({ _tag: "CupMaps", week, entrants: ["1", "2"], maps });
    expect(told.content).toContain("1. [Map 3](<https://ballestrecords.com/map/pf3>) · 4 votes");
    expect(told.content).toContain("3. [Map 7](<https://ballestrecords.com/map/pf7>) · 2 votes");
    expect(told.content).toContain(`<t:${week.endsAt / 1000}:F>`);
    expect(told.content).toContain("<@1> <@2>");
    expect(pinged(told)).toEqual(["1", "2"]);
  });

  it("keeps the Shortlist's Maps once the vote closes, with no vote and saying so", () => {
    const closed = shortlistMessage({
      guildId: cup.guildId,
      week,
      wanted: 10,
      closed: true,
      maps: [1, 2, 3].map((n) => ({ map: cupMap(n), picture: null })),
    });
    const text = words(closed);
    expect(text).toContain("Vote closed");
    expect(text).toContain("[Map 2](<https://ballestrecords.com/map/pf2>)");
    expect(text).not.toContain("custom_id");
    expect(text).not.toContain("Vote for up to");
  });

  const standingsView = (
    final: boolean,
    lateReads: StandingsView["lateReads"] = [],
  ): StandingsView => ({
    guildId: cup.guildId,
    week,
    maps: [cupMap(3), cupMap(1)],
    final,
    lateReads,
    standings: cupStandings([cupMap(3), cupMap(1)], ["111", "222", "333"], {
      pf3: { "222": ticks(12.5), "111": ticks(13) },
      pf1: { "111": ticks(40) },
    }),
  });
  const NAMES = new Map([
    ["111", "Alice"],
    ["222", "Bob"],
    ["333", "Cara"],
  ]);
  const PNG = new Uint8Array([1, 2, 3]);
  /** Each attachment's name, alt text and bytes. */
  const filesOf = (p: Payload) =>
    (p.files ?? []).map((f) => {
      const a = f as AttachmentBuilder;
      return { name: a.name, alt: a.description, bytes: [...(a.attachment as Buffer)] };
    });
  /** Every way a time of these Entrants could be written. */
  const TIMES = ["12.500", "12.5", "13.000", "40.000", "0:12", "0:13", "0:40"];

  it("draws the live standings' picture with each Entrant's places and points, and no time", () => {
    const image = cupStandingsImage(standingsView(false), NAMES);
    expect(image.maps).toEqual(["Map 3", "Map 1"]);
    expect(image.rows.map((r) => [r.place, r.name, r.total, r.wins, r.cells])).toEqual([
      [
        1,
        "Alice",
        60000,
        1,
        [
          { rank: 2, time: null },
          { rank: 1, time: null },
        ],
      ],
      [2, "Bob", 40000, 1, [{ rank: 1, time: null }, null]],
      [3, "Cara", 0, 0, [null, null]],
    ]);
    const all = JSON.stringify(image);
    for (const t of TIMES) expect(all).not.toContain(t);
  });

  it("draws the results' picture with each time beside its place", () => {
    const image = cupStandingsImage(standingsView(true), NAMES);
    expect(image.subtitle).toContain("results");
    expect(image.rows.map((r) => r.cells)).toEqual([
      [
        { rank: 2, time: "13.000" },
        { rank: 1, time: "40.000" },
      ],
      [{ rank: 1, time: "12.500" }, null],
      [null, null],
    ]);
  });

  it("posts the live standings as that picture, with the Cup Maps' pages and no time, pinging nobody", () => {
    const live = cupStandingsMessage(standingsView(false), PNG);
    expect(live.components ?? []).toEqual([]);
    expect(filesOf(live)).toEqual([
      { name: "cup-standings.png", alt: expect.any(String), bytes: [1, 2, 3] },
    ]);
    const text = live.content ?? "";
    expect(text).toContain("Live standings");
    expect(text).toContain(`<t:${week.endsAt / 1000}:F>`);
    expect(text).toContain("[Map 3](<https://ballestrecords.com/map/pf3>)");
    expect(text).toContain("[Map 1](<https://ballestrecords.com/map/pf1>)");
    for (const t of TIMES) {
      expect(text).not.toContain(t);
      expect(filesOf(live)[0]?.alt).not.toContain(t);
    }
    pingsNobody(live);
  });

  it("says on the live standings, once the results are up, that racing closed, and drops its picture", () => {
    const closed = cupStandingsClosedMessage(standingsView(true));
    const text = closed.content ?? "";
    expect(text).toContain("Racing closed");
    expect(text).toContain("results");
    expect(text).not.toContain("Read every 5 minutes");
    expect(closed.files ?? []).toEqual([]);
    expect(closed.attachments).toEqual([]);
    pingsNobody(closed);
  });

  it("posts the results with the winner and the picture with every time, pinging the Entrants", () => {
    const parts = cupResultsMessages(standingsView(true), PNG);
    expect(parts).toHaveLength(1);
    const results = parts[0] ?? {};
    const text = results.content ?? "";
    expect(text).toContain("Results");
    expect(text).toContain("<@111> wins this week's Weekly Cup");
    expect(text).not.toContain("Live standings");
    expect(filesOf(results)).toEqual([
      { name: "cup-results.png", alt: expect.any(String), bytes: [1, 2, 3] },
    ]);
    expect(pinged(results)).toEqual(["111", "222", "333"]);
  });

  it("says in the results which Cup Maps were read late, or not at the end", () => {
    const late = week.endsAt + 600_000;
    const textOf = (lateReads: StandingsView["lateReads"]) =>
      cupResultsMessages(standingsView(true, lateReads), PNG)[0]?.content ?? "";
    const text = textOf([
      { pfid: "pf3", at: late },
      { pfid: "pf1", at: null },
    ]);
    expect(text).toContain(`Map 3 was read late, at <t:${late / 1000}:t>`);
    expect(text).toContain("Map 1 couldn't be read at the end");
    expect(textOf([])).not.toContain("read late");
  });

  it("pings each of 100 Entrants once across the results' messages, the picture on the first", () => {
    const entrants = Array.from({ length: 100 }, (_, i) =>
      String(100_000_000_000_000_000n + BigInt(i)),
    );
    const maps = [cupMap(1), cupMap(2), cupMap(3)];
    const times = Object.fromEntries(
      maps.map((m) => [m.pfid, Object.fromEntries(entrants.map((id, i) => [id, ticks(20 + i)]))]),
    );
    const parts = cupResultsMessages(
      {
        guildId: cup.guildId,
        week,
        maps,
        final: true,
        lateReads: [],
        standings: cupStandings(maps, entrants, times),
      },
      PNG,
    );
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((p) => filesOf(p).length)).toEqual([1, ...parts.slice(1).map(() => 0)]);
    const pings = parts.flatMap((p) => pinged(p));
    expect([...pings].sort()).toEqual([...entrants].sort());
    for (const p of parts) {
      const text = p.content ?? "";
      expect(text.length).toBeLessThanOrEqual(2000);
      // Every mention whole within its message.
      expect(text.split("<@").length - 1).toBe([...text.matchAll(/<@\d+>/g)].length);
    }
  });

  it("sends each one-time Cup post with a nonce of its server, week and kind, which Discord enforces", () => {
    const kinds = ["post", "shortlist", "cupmaps", "results-1", "results-10"];
    const nonces = kinds.map((kind) => sentOnce(post("open"), GUILD, cup.week, kind).nonce);
    for (const n of nonces) expect((n ?? "").length).toBeLessThanOrEqual(25);

    expect(new Set(nonces).size).toBe(kinds.length);
    expect(sentOnce(post("open"), GUILD, cup.week, "post")).toMatchObject({
      nonce: nonces[0],
      enforceNonce: true,
    });
    expect(sentOnce(post("open"), GUILD, "2026-11-02", "post").nonce).not.toBe(nonces[0]);
    // Discord matches a nonce across every channel the bot posts in, so two servers' posts of the
    // same week and kind, sent at the same moment, must not share one.
    expect(sentOnce(post("open"), "1552729776165486603", cup.week, "post").nonce).not.toBe(
      nonces[0],
    );
  });

  it("asks a server admin to confirm a skip, privately", () => {
    const ask = cupConfirmSkipMessage(cup.guildId, cup.week);
    expect(buttons(ask)).toEqual([
      { label: "Skip this week", does: { _tag: "CupConfirmSkip", ...cup } },
    ]);
    expect(ask.content).toContain("can't be undone");
    pingsNobody(ask);
  });
});
