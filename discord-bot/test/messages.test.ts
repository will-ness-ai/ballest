// The Discord messages the bot sends, built from plain data: which buttons each one offers,
// what they do, and who each one pings. No Discord needed; the payloads are checked as built.
import {
  type ActionRowBuilder,
  type ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from "discord.js";
import { describe, expect, it } from "vitest";
import type { DailyView } from "../src/dailyPost/card.js";
import { dailyCard, dailyLineMessage, type DailyMessage } from "../src/dailyPost/messages.js";
import type { MatchState, MatchType } from "../src/domain.js";
import { parseControl } from "../src/discord/controls.js";
import type { MarbleEmojis } from "../src/discord/marbles.js";
import {
  cardMessage,
  closedCardMessage,
  confirmLeaveMessage,
  fingerprint,
  footerMessage,
  type Payload,
  pingDeclinedMessage,
  pingOfferMessage,
  pingsMessage,
  pingUnreadMessage,
  threadMessage,
  withPingFailure,
} from "../src/discord/messages.js";
import { ThreadPost } from "../src/ports.js";
import { reportButtons } from "../src/report/messages.js";
import { ALICE, BOB, CARA, cardView, drawnMap, ticks } from "./harness.js";

const marbles: MarbleEmojis = { forHue: () => "", forPlayer: () => "" };
const art = { marbles, png: null };
const PNG = Buffer.from([]);
const ROLE = "555";
/** A Card redrawn: the ping line, if any, mentions nobody. */
const redrawn = { roleId: ROLE, announce: false };
/** A Card's first post: a Lobby's ping line mentions the role. */
const announced = { roleId: ROLE, announce: true };
const MAP = drawnMap();
const WORKSHOP = "Open Map in Workshop";

/** Each button on a message: its label, and what it does (its Control, or its link). */
const buttons = (p: Payload) =>
  (p.components ?? [])
    .flatMap((row) => (row as ActionRowBuilder<ButtonBuilder>).toJSON().components)
    .map((b) => ({
      label: "label" in b ? b.label : undefined,
      does: "custom_id" in b ? parseControl(b.custom_id) : "url" in b ? b.url : null,
    }));

const labels = (p: Payload) => buttons(p).map((b) => b.label);

/** Each embed on a message, as Discord gets it. */
const embeds = (p: Payload) => (p.embeds ?? []).map((e) => ("toJSON" in e ? e.toJSON() : e));

/** Who a message pings: the user ids it lets Discord mention. */
const pinged = (p: Payload) => p.allowedMentions?.users ?? [];

const card = (state: MatchState, type: MatchType) =>
  cardView("7", {
    state,
    type,
    players: [ALICE, BOB],
    map: state === "invite" ? null : MAP,
    expiresAt: state === "invite" ? 1 : null,
    endsAt: state === "live" ? 1 : null,
  });

/** A message that can't notify anyone: no users, no roles, nothing parsed from its text. */
const pingsNobody = (p: Payload) => expect(p.allowedMentions).toEqual({ parse: [] });

describe("the Footer", () => {
  it("offers New Match, Link Steam and Pings, and pings nobody", () => {
    const footer = footerMessage(PNG);
    expect(buttons(footer)).toEqual([
      { label: "New Match", does: { _tag: "NewMatch" } },
      { label: "Link Steam", does: { _tag: "LinkSteam" } },
      { label: "Pings", does: { _tag: "Pings" } },
    ]);
    pingsNobody(footer);
  });
});

describe("Lobby pings, privately", () => {
  // A server that named the role differently: the buttons follow its name.
  const ROLE = { id: "555", name: "@Multiplayer Pings" };
  /** Each button's colour, beside its label. */
  const styles = (p: Payload) =>
    (p.components ?? [])
      .flatMap((row) => (row as ActionRowBuilder<ButtonBuilder>).toJSON().components)
      .map((b) => b.style);

  it("the Pings reply, off: says so, names the role, and offers Get", () => {
    const off = pingsMessage(false, ROLE);
    expect(off.content).toBe("**Lobby pings: off**\nYou don't have <@&555>.");
    expect(buttons(off)).toEqual([
      { label: "Get @Multiplayer Pings", does: { _tag: "SetPing", on: true } },
    ]);
    expect(styles(off)).toEqual([ButtonStyle.Success]);
    pingsNobody(off);
  });

  it("the Pings reply, on: says so, names the role, and offers Remove", () => {
    const on = pingsMessage(true, ROLE);
    expect(on.content).toBe("**Lobby pings: on**\nYou have <@&555>.");
    expect(buttons(on)).toEqual([
      { label: "Remove @Multiplayer Pings", does: { _tag: "SetPing", on: false } },
    ]);
    expect(styles(on)).toEqual([ButtonStyle.Secondary]);
    pingsNobody(on);
  });

  it("the offer: names the role, points at Pings, and offers Get or No", () => {
    const offer = pingOfferMessage(ROLE);
    expect(offer.content).toBe(
      "Get <@&555> to hear when someone opens a Lobby. Change it later from **Pings**.",
    );
    expect(buttons(offer)).toEqual([
      { label: "Get @Multiplayer Pings", does: { _tag: "SetPing", on: true } },
      { label: "No", does: { _tag: "DeclinePing" } },
    ]);
    expect(styles(offer)).toEqual([ButtonStyle.Success, ButtonStyle.Secondary]);
    pingsNobody(offer);
  });

  it("a failed Get or Remove adds the failure line to the same reply, once", () => {
    const failed = withPingFailure(pingOfferMessage(ROLE).content ?? "", ROLE);
    expect(failed).toBe(
      "Get <@&555> to hear when someone opens a Lobby. Change it later from **Pings**.\nDiscord didn't change <@&555>. Try again in a moment.",
    );
    // Failing again doesn't stack the line.
    expect(withPingFailure(failed, ROLE)).toBe(failed);
    expect(withPingFailure(pingsMessage(false, ROLE).content ?? "", ROLE)).toBe(
      "**Lobby pings: off**\nYou don't have <@&555>.\nDiscord didn't change <@&555>. Try again in a moment.",
    );
  });

  it("No turns the offer into a line with no buttons", () => {
    const declined = pingDeclinedMessage();
    expect(declined.content).toBe("Lobby pings: off. Change it later from **Pings**.");
    expect(declined.components).toEqual([]);
    pingsNobody(declined);
  });

  it("says plainly when Discord wouldn't say whether you have the role", () => {
    const unread = pingUnreadMessage(ROLE);
    expect(unread.content).toBe(
      "Discord didn't say whether you have <@&555>. Try again in a moment.",
    );
    expect(unread.components).toEqual([]);
    pingsNobody(unread);
  });
});

describe("the Card", () => {
  it.each([
    ["invite", "public", ["Accept", "Cancel"]],
    ["invite", "challenge", ["Accept", "Decline", "Cancel"]],
    ["invite", "lobby", ["Join (2)", "Leave", "Start", "Cancel"]],
    ["live", "public", [WORKSHOP, "Leave"]],
    ["live", "challenge", [WORKSHOP, "Leave"]],
    ["live", "lobby", ["Join (2)", WORKSHOP, "Leave"]],
    ["finished", "public", []],
    ["finished", "lobby", []],
  ] as const)("a %s %s offers %j", (state, type, expected) => {
    expect(labels(cardMessage(card(state, type), PNG, redrawn))).toEqual(expected);
  });

  it("offers only the Workshop link once time is up and the Result waits for Steam", () => {
    const waiting = cardMessage({ ...card("live", "lobby"), waitingForSteam: true }, PNG, redrawn);
    expect(labels(waiting)).toEqual([WORKSHOP]);
  });

  it("wires every button to its action on this Match", () => {
    const lobby = buttons(cardMessage(card("invite", "lobby"), PNG, redrawn));
    expect(lobby.map((b) => b.does)).toEqual(
      (["join", "leave", "start", "cancel"] as const).map((action) => ({
        _tag: "Act",
        action,
        matchId: "7",
      })),
    );
    const live = buttons(cardMessage(card("live", "lobby"), PNG, redrawn));
    expect(live[0]?.does).toEqual({ _tag: "Act", action: "join", matchId: "7" });
    expect(live[1]?.does).toContain(MAP.pfid);
    // Leave on a live Match asks first
    expect(live[2]?.does).toEqual({ _tag: "AskLeave", matchId: "7" });
    const confirm = buttons(confirmLeaveMessage("7"));
    expect(confirm.map((b) => b.does)).toEqual([
      { _tag: "ConfirmLeave", matchId: "7" },
      { _tag: "Stay" },
    ]);
  });

  it("never pings", () => {
    for (const state of ["invite", "live", "finished"] as const)
      expect(pinged(cardMessage(card(state, "lobby"), PNG, redrawn))).toEqual([]);
  });

  it("a Lobby's first post pings only the role, with who opened it and for how long", () => {
    const first = cardMessage(
      cardView("7", { type: "lobby", creator: ALICE, players: [ALICE], minutes: 15 }),
      PNG,
      announced,
    );
    expect(first.content).toBe(`<@&555> **<@${ALICE.discordId}>** opened a 15-minute Lobby`);
    expect(first.allowedMentions).toEqual({ parse: [], roles: [ROLE] });
  });

  it("a Lobby keeps its line on every redraw, live and finished, and pings nobody", () => {
    for (const state of ["invite", "live", "finished"] as const) {
      const again = cardMessage(
        cardView("7", { state, type: "lobby", creator: ALICE, minutes: 15 }),
        PNG,
        redrawn,
      );
      expect(again.content).toBe(`<@&555> **<@${ALICE.discordId}>** opened a 15-minute Lobby`);
      expect(again.allowedMentions).toEqual({ parse: [] });
    }
  });

  it("a Public 1v1 or Challenge has no line and pings nobody, even on its first post", () => {
    for (const type of ["public", "challenge"] as const) {
      const first = cardMessage(card("invite", type), PNG, announced);
      expect(first.content).toBe("");
      expect(first.allowedMentions).toEqual({ parse: [] });
    }
  });

  it("a kept-cancelled Card says why, with no line, and pings nobody", () => {
    for (const reason of ["noEligibleMap", "abandoned"] as const) {
      const closed = closedCardMessage(reason);
      expect(closed.content).toBe("");
      expect(closed.allowedMentions).toEqual({ parse: [] });
    }
  });

  it("names its Map, linked to the Map's page on the site, once the Map is drawn", () => {
    for (const state of ["live", "finished"] as const) {
      const [embed] = embeds(cardMessage(card(state, "public"), PNG, redrawn));
      expect(embed?.title).toBe("Map 1");
      expect(embed?.url).toBe("https://ballestrecords.com/map/pf1");
    }
    const waiting = cardMessage({ ...card("live", "lobby"), waitingForSteam: true }, PNG, redrawn);
    expect(embeds(waiting)[0]?.url).toBe("https://ballestrecords.com/map/pf1");
    // The Invite keeps its Map sealed
    const [invite] = embeds(cardMessage(card("invite", "lobby"), PNG, redrawn));
    expect(invite?.title).toBeUndefined();
    expect(invite?.url).toBeUndefined();
  });

  it("keeps each row within Discord's five buttons", () => {
    for (const state of ["invite", "live", "finished"] as const)
      for (const type of ["public", "challenge", "lobby"] as const)
        for (const row of cardMessage(card(state, type), PNG, redrawn).components ?? [])
          expect(
            (row as ActionRowBuilder<ButtonBuilder>).toJSON().components.length,
          ).toBeLessThanOrEqual(5);
  });
});

describe("thread posts", () => {
  const live = card("live", "lobby");

  it.each([
    ["Opened", ThreadPost.Opened({ by: ALICE, skin: null, type: "lobby", minutes: 10 })],
    ["Accepted", ThreadPost.Accepted({ player: BOB, skin: null })],
    ["Joined", ThreadPost.Joined({ player: CARA, skin: null })],
    ["Left", ThreadPost.Left({ player: CARA, skin: null })],
    ["Result", ThreadPost.Result({ standings: [], card: live, steamDown: false })],
    ["Result, Steam down", ThreadPost.Result({ standings: [], card: live, steamDown: true })],
    ["WaitingForSteam", ThreadPost.WaitingForSteam()],
    ["Progression", ThreadPost.Progression({ card: live, history: [] })],
    ["Abandoned", ThreadPost.Abandoned()],
    [
      "Improved",
      ThreadPost.Improved({
        improvement: {
          player: BOB,
          ticks: ticks(20),
          medal: null,
          rank: 1,
          previousTicks: null,
          previousRank: null,
          beatWorldRecord: null,
        },
        skin: null,
      }),
    ],
  ] as const)("%s pings nobody", (_, post) => {
    expect(pinged(threadMessage("7", post, art))).toEqual([]);
  });

  it("the start ping pings exactly the Players it sends off, with the Workshop link", () => {
    const everyone = threadMessage(
      "7",
      ThreadPost.Started({ players: [ALICE, BOB], map: MAP, endsAt: 1, card: live }),
      art,
    );
    expect(pinged(everyone)).toEqual([ALICE.discordId, BOB.discordId]);
    const lateJoin = threadMessage(
      "7",
      ThreadPost.Started({ players: [CARA], map: MAP, endsAt: 1, card: live }),
      art,
    );
    expect(pinged(lateJoin)).toEqual([CARA.discordId]);
    expect(labels(lateJoin)).toEqual([WORKSHOP]);
  });

  it("the start ping and the Result name the Map, linked to its page on the site", () => {
    const link = "[Map 1](<https://ballestrecords.com/map/pf1>)";
    const go = ThreadPost.Started({ players: [ALICE], map: MAP, endsAt: 1, card: live });
    expect(threadMessage("7", go, art).content).toContain(`**Go!** on ${link}`);
    const finished = card("finished", "public");
    for (const standings of [[], [{ player: ALICE, ticks: ticks(20), rank: 1, medal: null }]]) {
      const result = ThreadPost.Result({ standings, card: finished, steamDown: false });
      expect(threadMessage("7", result, art).content).toContain(`on ${link}`);
    }
  });

  it("escapes a Map title's markdown and mentions in its link", () => {
    const sly = { ...MAP, title: "*@everyone* [x]" };
    const go = ThreadPost.Started({ players: [ALICE], map: sly, endsAt: 1, card: live });
    expect(threadMessage("7", go, art).content).toContain(
      "[\\*@\u200beveryone\\* \\[x\\]](<https://ballestrecords.com/map/pf1>)",
    );
  });

  it("a Challenge pings only its target, who can answer from the post", () => {
    const post = ThreadPost.Challenged({
      by: ALICE,
      skin: null,
      target: BOB,
      minutes: 10,
      expiresAt: 1,
    });
    const message = threadMessage("7", post, art);
    expect(pinged(message)).toEqual([BOB.discordId]);
    expect(buttons(message).map((b) => b.does)).toEqual([
      { _tag: "Act", action: "accept", matchId: "7" },
      { _tag: "Act", action: "decline", matchId: "7" },
    ]);
  });

  it("pings each Player with a PB to beat, and everyone when no Map fits", () => {
    const bars = [{ player: CARA, ticks: ticks(20) }];
    expect(pinged(threadMessage("7", ThreadPost.PlayedBefore({ bars }), art))).toEqual([
      CARA.discordId,
    ]);
    expect(pinged(threadMessage("7", ThreadPost.NoMap({ players: [ALICE, BOB] }), art))).toEqual([
      ALICE.discordId,
      BOB.discordId,
    ]);
  });
});

describe("Play again", () => {
  const finished = card("finished", "public");
  const playAgain = { label: "Play again", does: { _tag: "PlayAgain", matchId: "7" } };

  it("the Result offers it, whether or not anyone finished", () => {
    for (const steamDown of [false, true])
      expect(
        buttons(
          threadMessage("7", ThreadPost.Result({ standings: [], card: finished, steamDown }), art),
        ),
      ).toEqual([playAgain]);
  });

  it("the post that it opened pings the finished Match's other Players, and offers it again", () => {
    const post = ThreadPost.PlayingAgain({
      by: ALICE,
      skin: null,
      others: [BOB, CARA],
      minutes: 10,
    });
    const message = threadMessage("7", post, art);
    expect(pinged(message)).toEqual([BOB.discordId, CARA.discordId]);
    expect(buttons(message)).toEqual([playAgain]);
  });
});

describe("fingerprint", () => {
  it("is the same for two payloads that draw the same message", () => {
    expect(fingerprint(footerMessage(Buffer.from([1, 2])))).toBe(
      fingerprint(footerMessage(Buffer.from([1, 2]))),
    );
  });

  it("changes when the image, the text or the buttons do", () => {
    const footer = footerMessage(Buffer.from([1, 2]));
    expect(fingerprint(footerMessage(Buffer.from([1, 3])))).not.toBe(fingerprint(footer));
    expect(fingerprint({ ...footer, content: "hi" })).not.toBe(fingerprint(footer));
    expect(fingerprint({ ...footer, components: [] })).not.toBe(fingerprint(footer));
  });
});

describe("the Daily Report's channel message", () => {
  it("has one link button under the image, to the site's Where you stand", () => {
    expect(reportButtons).toEqual([
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Link,
            label: "Where do I stand?",
            url: "https://ballestrecords.com/you",
          },
        ],
      },
    ]);
  });
});

describe("a Daily Post's card", () => {
  const view: DailyView = {
    date: "2026-10-18",
    pfid: "3796494598",
    title: "the drop",
    maker: "AvgRon",
    endsAt: Date.UTC(2026, 9, 19, 1),
    medals: { bronze: 14, silver: 11, gold: 9, author: 8.9 },
    board: { players: 1, top: [{ name: "<@123>", ticks: ticks(9) }] },
    readAt: Date.UTC(2026, 9, 18, 17),
  };
  const card = (pictures: Parameters<typeof dailyCard>[1]) => dailyCard(view, pictures).message;
  const message = card({ preview: "kept" });
  const links = (m: DailyMessage) =>
    JSON.stringify(m.components).match(/"label":"[^"]+","url":"[^"]+"/g);

  it("links to the Map's Workshop page, then the Daily's board on the site", () => {
    expect(links(message)).toEqual([
      '"label":"Steam Workshop","url":"https://steamcommunity.com/sharedfiles/filedetails/?id=3796494598"',
      '"label":"Today\'s board","url":"https://ballestrecords.com/daily/2026-10-18"',
    ]);
  });

  it("pings nobody, whatever a name holds", () => {
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });

  it("is a Components V2 card that shows the screenshot only when it is attached", () => {
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(JSON.stringify(message)).toContain("attachment://preview.jpg");
    expect(JSON.stringify(card({}))).not.toContain("attachment://");
  });

  it("shows the spinning GIF beside the podium once it is attached, and not before", () => {
    const spinning = JSON.stringify(card({ preview: "kept", spin: "kept" }));
    expect(spinning).toContain('"accessory":{"type":11,"media":{"url":"attachment://spin.gif"}}');
    expect(spinning).toContain("🥇");
    expect(JSON.stringify(message)).not.toContain("spin.gif");
  });

  it("draws the lead graph under the podium only when it is attached", () => {
    const parts = (m: DailyMessage) =>
      JSON.stringify(m.components).match(/🥇|attachment:\/\/[a-z]+\.[a-z]+/g);
    expect(parts(card({ preview: "kept", graph: "kept", spin: "kept" }))).toEqual([
      "attachment://preview.jpg",
      "🥇",
      "attachment://spin.gif",
      "attachment://graph.png",
    ]);
    expect(JSON.stringify(message)).not.toContain("graph.png");
  });

  it("once closed, heads it with the winner, keeps its pictures and graph, and links its final board", () => {
    const closed = card({ preview: "kept", graph: "kept", spin: "kept", closed: true });
    const text = JSON.stringify(closed.components);
    expect(text.match(/🏆|🥇|attachment:\/\/[a-z]+\.[a-z]+|Closed|Updated/g)).toEqual([
      "🏆",
      "attachment://preview.jpg",
      "🥇",
      "attachment://spin.gif",
      "attachment://graph.png",
      "Closed",
    ]);
    expect(links(closed)).toEqual([
      '"label":"Steam Workshop","url":"https://steamcommunity.com/sharedfiles/filedetails/?id=3796494598"',
      '"label":"Final board","url":"https://ballestrecords.com/daily/2026-10-18"',
    ]);
    expect(closed.allowed_mentions).toEqual({ parse: [] });
  });

  it("attaches each new picture under the name it shows by, and none it keeps", () => {
    const png = new Uint8Array([2]),
      gif = new Uint8Array([3]);
    const { message: shown, files } = dailyCard(view, {
      preview: "kept",
      graph: png,
      spin: gif,
    });
    expect(files).toEqual([
      { name: "graph.png", data: png },
      { name: "spin.gif", data: gif },
    ]);
    const urls = JSON.stringify(shown.components).match(/attachment:\/\/[a-z]+\.[a-z]+/g);
    for (const f of files) expect(urls).toContain(`attachment://${f.name}`);
    expect(dailyCard(view, { preview: "kept", graph: "kept" }).files).toEqual([]);
  });
});

describe("a Daily Post's thread line", () => {
  const line = dailyLineMessage("-# 🏁 **@everyone** sets the first time: **0:08.912**");

  it("pings nobody and notifies nobody", () => {
    expect(line.allowed_mentions).toEqual({ parse: [] });
    expect(line.flags).toBe(MessageFlags.SuppressNotifications);
  });
});
