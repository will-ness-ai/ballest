// Every message the bot posts, as discord.js payloads. The images in them come from
// src/render/; here they are only attached, with the buttons and text around them.
import { createHash } from "node:crypto";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type BaseMessageOptions,
} from "discord.js";
import {
  DURATIONS,
  formatTime,
  MATCH_TYPE_NAME,
  type MatchType,
  type Minutes,
  SCORE_TICKS_PER_SECOND,
} from "../domain.js";
import {
  DECLINE_PING,
  getPing,
  pingFailed,
  pingUnread,
  pingDeclined,
  pingOffer,
  PINGS_LABEL,
  pingsHave,
  pingsState,
  removePing,
} from "../pingWords.js";
import { escape, mapLink, mapName, mapUrl, workshopUrl } from "../links.js";
import { type HowtoPart, STEAM_LINK_HOWTO } from "../present.js";
import { RESULT_HUE, START_HUE } from "../render/art.js";
import type { CardView, KeptReason, ThreadPost } from "../ports.js";
import type { StatsAnswer } from "../seeMyStats.js";
import type { Preview } from "../previews.js";
import {
  CUP_MAPS,
  type CupNotice,
  type CupPostView,
  type ShortlistView,
  type StandingsView,
} from "../weeklyCup/schedule.js";
import { CUP_TIME_ZONE } from "../weeklyCup/week.js";
import { type Action, type Control, controlId } from "./controls.js";
import type { MarbleEmojis } from "./marbles.js";

/**
 * A message to post or edit. `attachments: []` on an edit drops the old image; discord.js adds
 * the new files to it, so the same payload posts and redraws.
 */
export type Payload = BaseMessageOptions & { readonly attachments?: Array<never> };

/**
 * A hash of everything a payload shows: text, embeds, buttons, and each file's name and bytes.
 * Two payloads with the same fingerprint draw the same message, so a message already showing
 * one needs no edit.
 */
export const fingerprint = (payload: Payload): string => {
  const { files = [], ...rest } = payload;
  const hash = createHash("sha256").update(JSON.stringify(rest));
  for (const file of files) {
    if (!(file instanceof AttachmentBuilder) || !Buffer.isBuffer(file.attachment))
      throw new Error("fingerprint: only in-memory attachments can be hashed");
    hash.update(`\0${file.name ?? ""}\0`).update(file.attachment);
  }
  return hash.digest("hex");
};

export const PROFILE_FIELD = "profile";

// ---------------------------------------------------------------- formatting

const unix = (ms: number) => Math.floor(ms / 1000);
const who = (discordId: string) => `<@${discordId}>`;

/** Mentions shown as names without pinging anyone. */
export const quiet = { allowedMentions: { parse: [] } } as const;

const button = (label: string, control: Control, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder()
    .setCustomId(controlId(control))
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);

const row = (...buttons: Array<ButtonBuilder>) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);

const workshopLink = (pfid: string) =>
  new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel("Open Map in Workshop")
    .setURL(workshopUrl(pfid));

const workshopButton = (pfid: string) => row(workshopLink(pfid));

/** A rendered image, attached; editing a message with one replaces the old. */
const image = (png: Buffer, name: string) => ({
  files: [new AttachmentBuilder(png, { name })],
  attachments: [],
});

// ---------------------------------------------------------------- the Footer

export const footerMessage = (png: Buffer): Payload => ({
  content: "",
  embeds: [],
  ...image(png, "multiballs.png"),
  components: [
    row(
      button("New Match", { _tag: "NewMatch" }, ButtonStyle.Primary),
      button("Link Steam", { _tag: "LinkSteam" }),
      button(PINGS_LABEL, { _tag: "Pings" }),
    ),
  ],
  ...quiet,
});

// ---------------------------------------------------------------- the My Stats panel

/** A Components V2 message: its text lives in its components, and it has no `content`. */
export type V2Payload = Payload & { readonly flags: MessageFlags.IsComponentsV2 };

/** The one message in #my-stats (spec #323): what the button shows, and the button. */
export const myStatsPanelMessage = (): V2Payload => ({
  flags: MessageFlags.IsComponentsV2,
  components: [
    new ContainerBuilder()
      .setAccentColor(LIVE_LIME)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "## My stats\nSee your Circuit ranks, World records and Medals, drawn from ballestrecords.com.",
        ),
      )
      .addActionRowComponents(
        row(button("See my stats", { _tag: "SeeMyStats" }, ButtonStyle.Primary)),
      ),
  ],
  ...quiet,
});

// ---------------------------------------------------------------- the Weekly Cup

const CUP_GOLD = 0xf2c14e;

/** What a Cup's post says it is doing, by state, under its title. */
const cupStanding = (v: CupPostView): string => {
  const w = v.week;
  switch (v.state) {
    case "open":
      return `**Sign-up is open.** The Shortlist of 10 Maps nobody signed up has played is drawn <t:${unix(w.shortlistAt)}:F>. A week with fewer than 2 Entrants by then is cancelled.`;
    case "voting":
      return `**Voting** on the Shortlist until <t:${unix(w.voteClosesAt)}:F>. Late sign-ups are welcome until the Cup ends.`;
    case "racing":
      return `**Racing** until <t:${unix(w.endsAt)}:F>. Late sign-ups are welcome until then.`;
    case "final":
      return "**This week's Cup is over.** Sign-up is closed.";
    case "cancelled":
      return "**This week's Cup is cancelled.** The next Cup opens on Monday.";
    case "skipped":
      return "**Skipped this week** by a server admin. The next Cup opens on Monday.";
  }
};

const CUP_RULES =
  "**The rules**\n" +
  "- Play each Cup Map for 30 minutes at most, from your first run on it.\n" +
  "- Use no Ghosts.\n" +
  "It's an honour system: the bot blocks nothing, but late PBs are looked at.";

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", {
    timeZone: CUP_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** The week's Cup post (spec #353): where it stands, its schedule, the rules and its Entrants. */
export const weeklyCupMessage = (v: CupPostView): V2Payload => {
  const w = v.week;
  const cup = { guildId: v.guildId, week: w.week };
  const entrants =
    v.entrants.length === 0
      ? "No Entrants yet."
      : `**${v.entrants.length} ${v.entrants.length === 1 ? "Entrant" : "Entrants"}:** ${v.entrants.map(who).join(", ")}`;
  const schedule =
    `**This week** (US Central)\n` +
    `- Sign up until <t:${unix(w.endsAt)}:F>\n` +
    `- Shortlist drawn <t:${unix(w.shortlistAt)}:F>, vote for up to 3\n` +
    `- Racing <t:${unix(w.voteClosesAt)}:F> to <t:${unix(w.endsAt)}:F>`;
  const container = new ContainerBuilder()
    .setAccentColor(
      v.state === "open" || v.state === "voting" || v.state === "racing" ? CUP_GOLD : QUIET_GREY,
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Weekly Cup · week of ${shortDate(w.opensAt)}\n${cupStanding(v)}`,
      ),
      new TextDisplayBuilder().setContent(schedule),
      new TextDisplayBuilder().setContent(CUP_RULES),
      new TextDisplayBuilder().setContent(entrants),
    );
  const buttons =
    v.state === "open" || v.state === "voting" || v.state === "racing"
      ? [
          button("Sign up", { _tag: "CupSignUp", ...cup }, ButtonStyle.Primary),
          button("Withdraw", { _tag: "CupWithdraw", ...cup }),
          ...(v.state === "open"
            ? [button("Skip this week", { _tag: "CupSkip", ...cup }, ButtonStyle.Danger)]
            : []),
        ]
      : [];
  if (buttons.length > 0) container.addActionRowComponents(row(...buttons));
  return { flags: MessageFlags.IsComponentsV2, components: [container], ...quiet };
};

/** The words of a notice beside the post. */
const cupNoticeText = (n: CupNotice, pings: string): string => {
  switch (n._tag) {
    case "Cancelled":
      return (
        n.reason === "entrants"
          ? `This week's Weekly Cup is cancelled: fewer than 2 Players signed up by Thursday 12:00. ${pings}`
          : `This week's Weekly Cup is cancelled: there's no Map that none of its Entrants has Played. ${pings}`
      ).trim();
    case "Skipped":
      return n.entrants.length === 0
        ? "A server admin skipped this week's Weekly Cup. The next one opens on Monday."
        : `A server admin skipped this week's Weekly Cup. ${pings}, you were signed up: the next one opens on Monday.`;
    case "CupMaps":
      return [
        `## This week's Cup Maps`,
        ...n.maps.map(
          ({ map, votes }, i) =>
            `${i + 1}. ${mapLink(map)} · ${votes} ${votes === 1 ? "vote" : "votes"}`,
        ),
        `Racing is on until <t:${unix(n.week.endsAt)}:F>: each Cup Map for 30 minutes at most, no Ghosts. ${pings}`.trim(),
      ].join("\n");
  }
};

/** A message beside the post: the week cancelled, skipped or its Cup Maps. It pings its Entrants. */
export const cupNoticeMessage = (n: CupNotice): Payload => ({
  content: cupNoticeText(n, n.entrants.map(who).join(" ")),
  allowedMentions: { users: [...n.entrants] },
});

/** A Map's Workshop picture on the Shortlist, by its place there. */
const pictureName = (place: number, picture: Preview) =>
  `map-${place}.${picture.type === "image/png" ? "png" : picture.type === "image/gif" ? "gif" : "jpg"}`;

/**
 * The Shortlist (spec #353): each Map with its Workshop picture, its name linked to its page on
 * the site, its maker and author time, and the vote under them, up to 3 picks.
 */
export const shortlistMessage = (v: ShortlistView): V2Payload => {
  const cup = { guildId: v.guildId, week: v.week.week };
  const n = v.maps.length;
  const intro = [
    `## Shortlist · week of ${shortDate(v.week.opensAt)}`,
    v.closed === true
      ? `**Vote closed** <t:${unix(v.week.voteClosesAt)}:F>: this week's Cup Maps are announced below.`
      : `Vote for up to ${Math.min(CUP_MAPS, n)} by <t:${unix(v.week.voteClosesAt)}:F>: the most-voted are the Cup Maps, a tie drawn at random. Only Entrants can vote, and voting again changes your pick.`,
    ...(n < v.wanted
      ? [
          `Only ${n} ${n === 1 ? "Map fits" : "Maps fit"} this week (none of the Entrants has Played them), so the Shortlist is shorter.`,
        ]
      : []),
  ].join("\n");
  const container = new ContainerBuilder()
    .setAccentColor(CUP_GOLD)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(intro));
  const files: Array<AttachmentBuilder> = [];
  v.maps.forEach(({ map, picture }, i) => {
    const words = new TextDisplayBuilder().setContent(
      `**${i + 1}. ${mapLink(map)}**\nby ${escape(map.creator)} · author **${formatTime(Math.round(map.authorSeconds * SCORE_TICKS_PER_SECOND))}**`,
    );
    if (picture === null) {
      container.addTextDisplayComponents(words);
      return;
    }
    const name = pictureName(i + 1, picture);
    files.push(new AttachmentBuilder(Buffer.from(picture.body), { name }));
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(words)
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${name}`)),
    );
  });
  if (v.closed !== true)
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(controlId({ _tag: "CupVote", ...cup }))
          .setPlaceholder(`Vote for up to ${Math.min(CUP_MAPS, n)} Maps`)
          .setMinValues(1)
          .setMaxValues(Math.min(CUP_MAPS, n))
          .addOptions(
            v.maps.map(({ map }) => ({
              label: mapName(map).slice(0, 100),
              value: map.pfid,
              description: `by ${map.creator}`.slice(0, 100),
            })),
          ),
      ),
    );
  return { flags: MessageFlags.IsComponentsV2, components: [container], files, ...quiet };
};

/** Discord's limit on a message's text. */
const CONTENT_LIMIT = 2000;
/** Most timed rows shown under each Cup Map. */
const MAP_ROWS = 10;

const points = (n: number) => n.toLocaleString("en-US");

/**
 * The Cup's standings as plain text (spec #353, #358), live while racing and the results at the
 * end: overall by points, then each Cup Map's times. The one place their look lives, so the look
 * the organisers choose replaces this alone. Live standings ping nobody; the results ping the
 * Entrants.
 */
export const cupStandingsMessage = (v: StandingsView): Payload => {
  const { overall, maps } = v.standings;
  const head = v.final
    ? [
        `## Weekly Cup Results · week of ${shortDate(v.week.opensAt)}`,
        ...(overall[0] !== undefined && overall[0].total > 0
          ? [
              `${overall
                .filter((o) => o.place === 1)
                .map((o) => who(o.discordId))
                .join(
                  " and ",
                )} ${overall.filter((o) => o.place === 1).length === 1 ? "wins" : "share"} this week's Weekly Cup.`,
            ]
          : ["Nobody set a time on a Cup Map this week."]),
      ]
    : [
        `## Live standings · Weekly Cup, week of ${shortDate(v.week.opensAt)}`,
        `Read every 5 minutes until <t:${unix(v.week.endsAt)}:F>. Last change <t:${unix(v.readAt)}:R>.`,
      ];
  const table = [
    "**Overall**",
    ...overall.map(
      (o) =>
        `${o.place}. ${who(o.discordId)} · ${points(o.total)} pts${o.wins > 0 ? ` · ${o.wins} ${o.wins === 1 ? "win" : "wins"}` : ""}`,
    ),
  ];
  const perMap = maps.flatMap((m, i) => {
    const map = v.maps.find((c) => c.pfid === m.pfid);
    const timed = m.rows.flatMap((r) =>
      r.ticks === null || r.rank === null ? [] : [{ ...r, ticks: r.ticks, rank: r.rank }],
    );
    const untimed = m.rows.filter((r) => r.ticks === null).map((r) => who(r.discordId));
    return [
      "",
      `**${i + 1}. ${map === undefined ? escape(m.title) : mapLink(map)}**`,
      ...timed
        .slice(0, MAP_ROWS)
        .map(
          (r) => `${r.rank}. ${who(r.discordId)} **${formatTime(r.ticks)}** · ${points(r.points)}`,
        ),
      ...(timed.length > MAP_ROWS ? [`and ${timed.length - MAP_ROWS} more`] : []),
      ...(untimed.length > 0 ? [`No time yet: ${untimed.join(", ")}`] : []),
    ];
  });
  const lines = [...head, "", ...table, ...perMap];
  let content = lines.join("\n");
  if (content.length > CONTENT_LIMIT) content = `${content.slice(0, CONTENT_LIMIT - 2)}\n…`;
  return v.final
    ? { content, components: [], allowedMentions: { users: overall.map((o) => o.discordId) } }
    : { content, components: [], ...quiet };
};

/** A server admin's private Skip: asks first. */

export const cupConfirmSkipMessage = (guildId: string, week: string): Payload => ({
  content:
    "Skip this week's Weekly Cup? Its Entrants are told, and it can't be undone: the next Cup opens on Monday.",
  components: [
    row(button("Skip this week", { _tag: "CupConfirmSkip", guildId, week }, ButtonStyle.Danger)),
  ],
  ...quiet,
});

// ---------------------------------------------------------------- See my stats, privately

const linkButton = (label: string, url: string) =>
  new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);

const pairAgain = () => button("Not you? Pair again", { _tag: "PairAgain" });

/** Why there's no card: text alone, replacing whatever the answer showed before. */
const statsText = (content: string): Payload => ({
  content,
  embeds: [],
  files: [],
  attachments: [],
  components: [],
  ...quiet,
});

/** A member's private answer to See my stats, and each later version of it. */
export const statsAnswerMessage = (answer: StatsAnswer): Payload => {
  switch (answer._tag) {
    case "Card":
      return {
        content: "",
        embeds: [],
        ...image(answer.png, "stat-card.png"),
        components: [row(linkButton("Player page", answer.url), pairAgain())],
        ...quiet,
      };
    case "SignIn":
      return {
        content:
          "**Sign in with Steam** on ballestrecords.com to pair this Discord account with your Steam account. " +
          "Your card shows up here once you have. The link works once, for 15 minutes.",
        embeds: [],
        files: [],
        attachments: [],
        components: [row(linkButton("Sign in with Steam", answer.url))],
        ...quiet,
      };
    case "NoStats":
      // Still a way out for a member who paired the wrong account.
      return {
        ...statsText("No runs on the boards yet for the Steam account you paired."),
        components: [row(pairAgain())],
      };
    case "CardFailed":
      return statsText("Couldn't draw your card, try again.");
    case "Unavailable":
      return statsText("Stats aren't available right now. Try again in a while.");
  }
};

// ---------------------------------------------------------------- the Match Card

export const threadName = (v: CardView, creatorName: string) =>
  `${creatorName}'s ${MATCH_TYPE_NAME[v.type]} · ${v.minutes} min`;

const act = (action: Action, matchId: string): Control => ({ _tag: "Act", action, matchId });
const acceptButton = (matchId: string) =>
  button("Accept", act("accept", matchId), ButtonStyle.Success);
const declineButton = (matchId: string) =>
  button("Decline", act("decline", matchId), ButtonStyle.Danger);
/** On a finished Match's thread: everyone who presses it lands in the same new Lobby. */
const playAgainButton = (matchId: string) =>
  button("Play again", { _tag: "PlayAgain", matchId }, ButtonStyle.Success);

const cardButtons = (v: CardView) => {
  const join = () =>
    button(`Join (${v.players.length})`, act("join", v.matchId), ButtonStyle.Success);
  if (v.state === "live" && v.map !== null) {
    if (v.waitingForSteam) return [row(workshopLink(v.map.pfid))];
    const leave = button("Leave", { _tag: "AskLeave", matchId: v.matchId });
    return [
      v.type === "lobby"
        ? row(join(), workshopLink(v.map.pfid), leave)
        : row(workshopLink(v.map.pfid), leave),
    ];
  }
  if (v.state !== "invite") return [];
  const cancel = button("Cancel", act("cancel", v.matchId));
  if (v.type === "public") return [row(acceptButton(v.matchId), cancel)];
  if (v.type === "challenge")
    return [row(acceptButton(v.matchId), declineButton(v.matchId), cancel)];
  return [
    row(
      join(),
      button("Leave", act("leave", v.matchId)),
      button("Start", act("start", v.matchId), ButtonStyle.Primary),
      cancel,
    ),
  ];
};

/** The Match's clock as Discord timestamps (each reader sees their own time); none once it's over. */
const clockText = (v: CardView): string | null =>
  v.state === "invite" && v.expiresAt !== null
    ? `Invite expires <t:${unix(v.expiresAt)}:R>`
    : v.state === "live" && v.waitingForSteam
      ? "**Time's up** · the Result posts once Steam answers"
      : v.state === "live" && v.endsAt !== null
        ? `**Live** · ends <t:${unix(v.endsAt)}:R> (<t:${unix(v.endsAt)}:t>)`
        : null;

const QUIET_GREY = 0x4e5058;
const LIVE_LIME = 0x8be03c;

/**
 * How a Card treats the @Multiplayer ping role. `announce` is true only on the post that
 * creates the Card: Discord notifies a mention when a message is first posted, never on an edit.
 */
export interface CardPing {
  readonly roleId: string;
  readonly announce: boolean;
}

/** A Lobby's line above its Card: "@Multiplayer ping **@creator** opened a N-minute Lobby". */
const lobbyLine = (v: CardView, roleId: string) =>
  `<@&${roleId}> **${who(v.creator.discordId)}** opened a ${v.minutes}-minute Lobby`;

/**
 * The Card image, with an embed below it: the drawn Map's name, linked to its page on the site,
 * over the clock, which the image never shows. A Lobby's Card
 * keeps its ping line through live and finished, but only its first post lets the role be
 * mentioned. Public 1v1 and Challenge Cards have no line.
 */
export const cardMessage = (v: CardView, png: Buffer, ping: CardPing): Payload => {
  const text = clockText(v);
  const below = new EmbedBuilder().setColor(v.state === "live" ? LIVE_LIME : QUIET_GREY);
  if (v.map !== null) below.setTitle(escape(mapName(v.map))).setURL(mapUrl(v.map.pfid));
  if (text !== null) below.setDescription(text);
  const lobby = v.type === "lobby";
  return {
    content: lobby ? lobbyLine(v, ping.roleId) : "",
    embeds: v.map === null && text === null ? [] : [below],
    ...image(png, `match-${v.matchId}.png`),
    components: cardButtons(v),
    ...(lobby && ping.announce ? { allowedMentions: { parse: [], roles: [ping.roleId] } } : quiet),
  };
};

/** Why a kept Match was cancelled, on its Card and in its thread. */
const WHY_CANCELLED: Record<KeptReason, string> = {
  noEligibleMap: "No Map fits this Match: none suits the length. A longer Match allows more Maps.",
  abandoned: "Everyone left before anyone set a time.",
};

/** A cancelled Card that stays, saying why. */
export const closedCardMessage = (reason: KeptReason): Payload => ({
  content: "",
  embeds: [new EmbedBuilder().setTitle("Cancelled").setDescription(WHY_CANCELLED[reason])],
  files: [],
  attachments: [],
  components: [],
  ...quiet,
});

// ---------------------------------------------------------------- Match Thread posts ("Marble Icons")

/** The Match Thread's first message: the same clock as under the Card, kept at the thread's top. */
export const clockMessage = (v: CardView | "cancelled"): Payload => ({
  content: v === "cancelled" ? "**Cancelled**" : (clockText(v) ?? "**Finished**"),
  ...quiet,
});

/** What a thread post is drawn with, beyond the post itself. */
export interface ThreadArt {
  readonly marbles: MarbleEmojis;
  /** The post's image: the Card for Go! and the Result, the row for an Improvement, the graph after the Result. */
  readonly png: Buffer | null;
}

const line = (marble: string, text: string) => (marble === "" ? text : `${marble} ${text}`);

export const threadMessage = (matchId: string, post: ThreadPost, art: ThreadArt): Payload => {
  const pic = art.png === null ? {} : image(art.png, `${post._tag.toLowerCase()}.png`);
  switch (post._tag) {
    case "Opened":
      return {
        content: line(
          art.marbles.forPlayer(post.by.steamId, post.skin),
          `**${who(post.by.discordId)}** opened a ${post.minutes}-minute ${MATCH_TYPE_NAME[post.type]}`,
        ),
        ...quiet,
      };
    case "Challenged": {
      return {
        content: line(
          art.marbles.forPlayer(post.by.steamId, post.skin),
          `${who(post.target.discordId)} **${who(post.by.discordId)}** challenges you · ${post.minutes} min · answer <t:${unix(post.expiresAt)}:R>`,
        ),
        components: [row(acceptButton(matchId), declineButton(matchId))],
        allowedMentions: { users: [post.target.discordId] },
      };
    }
    case "Accepted":
      return {
        content: line(
          art.marbles.forPlayer(post.player.steamId, post.skin),
          `**${who(post.player.discordId)}** accepted`,
        ),
        ...quiet,
      };
    case "Joined":
      return {
        content: line(
          art.marbles.forPlayer(post.player.steamId, post.skin),
          `**${who(post.player.discordId)}** joined`,
        ),
        ...quiet,
      };
    case "Left":
      return {
        content: `-# ${line(art.marbles.forPlayer(post.player.steamId, post.skin), `**${who(post.player.discordId)}** left`)}`,
        ...quiet,
      };
    case "Started":
      return {
        content: line(
          art.marbles.forHue(START_HUE),
          `${post.players.map((p) => who(p.discordId)).join(" ")} **Go!** on ${mapLink(post.map)} · ends <t:${unix(post.endsAt)}:R>`,
        ),
        ...pic,
        components: [workshopButton(post.map.pfid)],
        allowedMentions: { users: post.players.map((p) => p.discordId) },
      };
    case "Improved":
      // A world record gets its line; no pings.
      return {
        content:
          post.improvement.beatWorldRecord === null
            ? ""
            : `🏆 **NEW WORLD RECORD** · ${who(post.improvement.player.discordId)}`,
        ...pic,
        ...quiet,
      };
    case "Progression":
      return { content: "", ...pic, ...quiet };
    case "Result":
      return {
        content: line(
          art.marbles.forHue(RESULT_HUE),
          "**Final result**" +
            (post.card.map === null ? "" : ` on ${mapLink(post.card.map)}`) +
            (post.standings.every((s) => s.rank === null) ? " · no finishers" : "") +
            (post.steamDown
              ? "\n-# Steam never gave the end-of-Match read, so these are the last times read before the end."
              : ""),
        ),
        ...pic,
        components: [row(playAgainButton(matchId))],
        ...quiet,
      };
    case "PlayingAgain":
      return {
        content: line(
          art.marbles.forPlayer(post.by.steamId, post.skin),
          [
            ...post.others.map((p) => who(p.discordId)),
            `**${who(post.by.discordId)}** opened a ${post.minutes}-minute Lobby to play again`,
          ].join(" "),
        ),
        components: [row(playAgainButton(matchId))],
        allowedMentions: { users: post.others.map((p) => p.discordId) },
      };
    case "WaitingForSteam":
      return {
        content:
          "⏱️ **Time's up**, stop playing. Steam isn't answering right now, so the Result will post once it does.",
        ...quiet,
      };
    case "PlayedBefore": {
      const pings = post.bars.map((b) => who(b.player.discordId)).join(" ");
      const pbs = post.bars
        .map((b) => `${who(b.player.discordId)} \`${formatTime(b.ticks)}\``)
        .join(" · ");
      return {
        content: `${pings} you've finished this Map before, so only a run **faster than your PB** counts; otherwise you're DNF.
-# PB to beat: ${pbs}`,
        allowedMentions: { users: post.bars.map((b) => b.player.discordId) },
      };
    }
    case "NoMap":
      return {
        content: `${post.players.map((p) => who(p.discordId)).join(" ")} **Match cancelled.** ${WHY_CANCELLED.noEligibleMap}`,
        allowedMentions: { users: post.players.map((p) => p.discordId) },
      };
    case "Abandoned":
      return { content: `**Match cancelled.** ${WHY_CANCELLED.abandoned}`, ...quiet };
  }
};

// ---------------------------------------------------------------- New Match (Type First), privately

export const pickTypeMessage = (): Payload => ({
  content: "**What kind of Match?**",
  components: [
    row(
      button("Public 1v1", { _tag: "PickType", type: "public" }, ButtonStyle.Primary),
      button("Challenge", { _tag: "PickType", type: "challenge" }, ButtonStyle.Primary),
      button("Lobby", { _tag: "PickType", type: "lobby" }, ButtonStyle.Primary),
    ),
  ],
});

export const pickTargetMessage = (): Payload => ({
  content: "**Challenge · who?**",
  components: [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(controlId({ _tag: "PickTarget" }))
        .setPlaceholder("Pick a Player")
        .setMaxValues(1),
    ),
  ],
});

export const pickDurationMessage = (
  type: MatchType,
  target: string | null,
  chosen: Minutes | null,
): Payload => {
  const durations = DURATIONS.map((minutes) =>
    button(
      `${minutes}m`,
      { _tag: "PickDuration", request: { type, target, minutes } },
      minutes === chosen ? ButtonStyle.Primary : ButtonStyle.Secondary,
    ),
  );
  return {
    content: `**${MATCH_TYPE_NAME[type]}${target ? ` vs ${who(target)}` : ""} · how long?**`,
    components: [
      row(...durations.slice(0, 4)),
      row(...durations.slice(4)),
      row(
        button(
          "Open Invite",
          { _tag: "OpenInvite", request: { type, target, minutes: chosen ?? DURATIONS[0] } },
          ButtonStyle.Success,
          chosen === null,
        ),
      ),
    ],
    ...quiet,
  };
};

// ---------------------------------------------------------------- Play again, privately

/** The presser's answer: where the Lobby's thread is, and whether the Start is theirs. */
export const playAgainText = (creator: boolean, threadId: string | null) => {
  const where = threadId === null ? "" : ` <#${threadId}>`;
  return creator
    ? `You opened the Lobby${where}. Press **Start** on its Card once everyone's in.`
    : `You're in the Lobby${where}.`;
};

// ---------------------------------------------------------------- Leave a live Match, privately

export const LEFT_TEXT = "You left the Match. Your best time so far stands.";

export const confirmLeaveMessage = (matchId: string): Payload => ({
  content: "**Leave this Match?** Your best time so far stands, but nothing after this counts.",
  components: [
    row(
      button("Leave", { _tag: "ConfirmLeave", matchId }, ButtonStyle.Danger),
      button("Stay", { _tag: "Stay" }),
    ),
  ],
});

// ---------------------------------------------------------------- Link Steam

const howtoMarkdown = (parts: ReadonlyArray<HowtoPart>) =>
  parts
    .map((p) => (typeof p === "string" ? p : "menu" in p ? `**${p.menu}**` : `\`${p.example}\``))
    .join("");

export const linkForm = () =>
  new ModalBuilder()
    .setCustomId(controlId({ _tag: "LinkForm" }))
    .setTitle("Link your Steam account")
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          ...STEAM_LINK_HOWTO.steps.map((step, n) => `${n + 1}. ${howtoMarkdown(step)}`),
          "",
          howtoMarkdown(STEAM_LINK_HOWTO.looksLike),
          `-# ${STEAM_LINK_HOWTO.notThis}`,
        ].join("\n"),
      ),
    )
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Steam profile link")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(PROFILE_FIELD)
            .setPlaceholder("https://steamcommunity.com/profiles/…")
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
    );

export const linkPreviewMessage = (png: Buffer): Payload => ({
  content: "**Is this your Steam account?**",
  embeds: [],
  ...image(png, "steam-account.png"),
  components: [
    row(
      button("Yes, link it", { _tag: "ConfirmLink" }, ButtonStyle.Success),
      button("Try again", { _tag: "LinkSteam" }),
    ),
  ],
});

export const tryAgainMessage = (text: string): Payload => ({
  content: text,
  embeds: [],
  files: [],
  attachments: [],
  components: [row(button("Try again", { _tag: "LinkSteam" }))],
});

// ---------------------------------------------------------------- Lobby pings, privately (spec #87)
// The role shows as a real mention, which pings nobody here: none of these allow mentions.

const roleMention = (roleId: string) => `<@&${roleId}>`;
const PINGS_BOLD = `**${PINGS_LABEL}**`;

/** The role, by id for its mention and by name ("@Multiplayer ping") for buttons, which can't hold one. */
export interface PingRoleRef {
  readonly id: string;
  readonly name: string;
}

const getPingButton = (role: PingRoleRef) =>
  button(getPing(role.name), { _tag: "SetPing", on: true }, ButtonStyle.Success);

/** The Footer's Pings reply: where the member stands, and the one button that changes it. */
export const pingsMessage = (on: boolean, role: PingRoleRef): Payload => ({
  content: `**${pingsState(on)}**\n${pingsHave(on, roleMention(role.id))}`,
  components: [
    row(on ? button(removePing(role.name), { _tag: "SetPing", on: false }) : getPingButton(role)),
  ],
  ...quiet,
});

/** Offered once, after a member's first Join or Accept from a Card. Get turns it into the Pings reply. */
export const pingOfferMessage = (role: PingRoleRef): Payload => ({
  content: pingOffer(roleMention(role.id), PINGS_BOLD),
  components: [row(getPingButton(role), button(DECLINE_PING, { _tag: "DeclinePing" }))],
  ...quiet,
});

/** What the offer becomes after No. */
export const pingDeclinedMessage = (): Payload => ({
  content: pingDeclined(PINGS_BOLD),
  components: [],
  ...quiet,
});

/** The Pings reply when Discord wouldn't say whether the member has the role. */
export const pingUnreadMessage = (role: PingRoleRef): Payload => ({
  content: pingUnread(roleMention(role.id)),
  components: [],
  ...quiet,
});

/**
 * A Get or Remove that Discord refused: the same reply's text with the failure line below it
 * (once, however often it fails), so its buttons stay to try again and nothing new piles up.
 */
export const withPingFailure = (content: string, role: PingRoleRef) => {
  const failed = pingFailed(roleMention(role.id));
  return `${content
    .split("\n")
    .filter((line) => line !== failed)
    .join("\n")}\n${failed}`;
};
