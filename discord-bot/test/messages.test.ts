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
  cupConfirmSkipMessage,
  cupNoticeMessage,
  cupStandingsMessage,
  shortlistMessage,
  weeklyCupMessage,
  fingerprint,
  footerMessage,
  myStatsPanelMessage,
  type Payload,
  pingDeclinedMessage,
  pingOfferMessage,
  pingsMessage,
  pingUnreadMessage,
  statsAnswerMessage,
  threadMessage,
  withPingFailure,
} from "../src/discord/messages.js";
import { ThreadPost } from "../src/ports.js";
import { reportButtons } from "../src/report/messages.js";
import { cupStandings } from "../src/weeklyCup/points.js";
import type { CupMap, CupState, StandingsView } from "../src/weeklyCup/schedule.js";
import { weekAt } from "../src/weeklyCup/week.js";
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

describe("the My Stats panel", () => {
  const panel = myStatsPanelMessage();
  /** The panel's buttons: Components V2 puts its row inside the container. */
  const panelButtons = () =>
    JSON.stringify(panel.components).match(/"custom_id":"[^"]+"|"label":"[^"]+"/g);

  it("is a Components V2 message with one See my stats button, and pings nobody", () => {
    expect(panel.flags).toBe(MessageFlags.IsComponentsV2);
    expect(panelButtons()).toEqual(['"custom_id":"mb:stats"', '"label":"See my stats"']);
    expect(parseControl("mb:stats")).toEqual({ _tag: "SeeMyStats" });
    pingsNobody(panel);
  });

  it("says what the button shows and where it comes from", () => {
    const text = JSON.stringify(panel.components);
    expect(text).toContain("See your Circuit ranks, World records and Medals");
    expect(text).toContain("ballestrecords.com");
  });

  it("draws the same every time, so a restart leaves it alone", () => {
    expect(fingerprint(myStatsPanelMessage())).toBe(fingerprint(panel));
  });
});

describe("See my stats's private answer", () => {
  const CARD_URL = "https://ballestrecords.com/player/76561198000000001";

  it("shows the Stat Card with a Player page link and a quiet Pair again", () => {
    const answer = statsAnswerMessage({
      _tag: "Card",
      steamId: "76561198000000001",
      png: PNG,
      url: CARD_URL,
    });
    expect(answer.files).toHaveLength(1);
    expect(buttons(answer)).toEqual([
      { label: "Player page", does: CARD_URL },
      { label: "Not you? Pair again", does: { _tag: "PairAgain" } },
    ]);
    pingsNobody(answer);
  });

  it("sends a member with no Stats Link to sign in with Steam, dropping any card", () => {
    const url = "https://ballestrecords.com/discord/link?t=abc";
    const answer = statsAnswerMessage({ _tag: "SignIn", url });
    expect(buttons(answer)).toEqual([{ label: "Sign in with Steam", does: url }]);
    expect(answer.files).toEqual([]);
    expect(answer.attachments).toEqual([]);
    pingsNobody(answer);
  });

  it("lets a member paired with an account with no runs pair again", () => {
    const answer = statsAnswerMessage({ _tag: "NoStats" });
    expect(answer.content).toContain("No runs on the boards yet");
    expect(buttons(answer)).toEqual([
      { label: "Not you? Pair again", does: { _tag: "PairAgain" } },
    ]);
    expect(answer.files).toEqual([]);
  });

  it.each([
    ["CardFailed", "Couldn't draw your card, try again."],
    ["Unavailable", "Stats aren't available"],
  ] as const)("says why there's no card (%s), with no buttons", (tag, text) => {
    const answer = statsAnswerMessage({ _tag: tag });
    expect(answer.content).toContain(text);
    expect(buttons(answer)).toEqual([]);
    expect(answer.files).toEqual([]);
    pingsNobody(answer);
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

  const standingsOf = (final: boolean, lateReads: StandingsView["lateReads"] = []) =>
    cupStandingsMessage({
      guildId: cup.guildId,
      week,
      maps: [cupMap(3), cupMap(1)],
      readAt: week.voteClosesAt + 3_600_000,
      final,
      lateReads,
      standings: cupStandings([cupMap(3), cupMap(1)], ["111", "222", "333"], {
        pf3: { "222": ticks(12.5), "111": ticks(13) },
        pf1: { "111": ticks(40) },
      }),
    });

  it("shows the live standings as plain text: overall, then each Cup Map, pinging nobody", () => {
    const live = standingsOf(false);
    expect(live.components ?? []).toEqual([]);
    const text = live.content ?? "";
    expect(text).toContain("Live standings");
    expect(text).toContain("1. <@111> · 60,000 pts");
    expect(text).toContain("2. <@222> · 40,000 pts");
    expect(text).toContain("3. <@333> · 0 pts");
    expect(text).toContain("[Map 3](<https://ballestrecords.com/map/pf3>)");
    expect(text).toContain("1. <@222> **0:12.500** · 40,000");
    expect(text).toContain("2. <@111> **0:13.000** · 20,000");
    expect(text).toContain("No time yet: <@333>");
    expect(text).toContain(`<t:${week.endsAt / 1000}:F>`);
    pingsNobody(live);
  });

  it("posts the results with the winner, pinging the Entrants", () => {
    const results = standingsOf(true);
    const text = results.content ?? "";
    expect(text).toContain("Results");
    expect(text).toContain("<@111> wins this week's Weekly Cup");
    expect(text).not.toContain("Live standings");
    expect(pinged(results)).toEqual(["111", "222", "333"]);
  });

  it("says in the results which Cup Maps were read late, or not at the end", () => {
    const late = week.endsAt + 600_000;
    const text =
      standingsOf(true, [
        { pfid: "pf3", at: late },
        { pfid: "pf1", at: null },
      ]).content ?? "";
    expect(text).toContain(`Map 3 was read late, at <t:${late / 1000}:t>`);
    expect(text).toContain("Map 1 couldn't be read at the end");
    expect(standingsOf(true).content).not.toContain("read late");
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
