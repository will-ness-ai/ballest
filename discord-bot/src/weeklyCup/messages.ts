// The Weekly Cup's messages (spec #353): its post, the notices beside it, the Shortlist with its
// vote, the standings and results, and Skip's confirmation, as discord.js payloads. The standings
// and results text lives in `cupStandingsMessages` alone, so their look can be swapped there.
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import { controlId } from "../discord/controls.js";
import {
  button,
  type Payload,
  QUIET_GREY,
  quiet,
  row,
  unix,
  type V2Payload,
  who,
} from "../discord/messages.js";
import { formatTime, SCORE_TICKS_PER_SECOND } from "../domain.js";
import { escape, mapLink, mapName } from "../links.js";
import type { Preview } from "../previews.js";
import {
  CUP_MAPS,
  type CupNotice,
  type CupPostView,
  type ShortlistView,
  type StandingsView,
} from "./model.js";
import { CUP_TIME_ZONE } from "./week.js";

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
  "- Only times set once racing opens count: a PB you already hold counts once you beat it.\n" +
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
    v.closed
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
  if (!v.closed)
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
 * end: overall by points, then each Cup Map's times, as one message or, past Discord's 2,000
 * characters, several in order, split between sections or lines (never inside a mention). The
 * one place their look lives, so the look the organisers choose replaces this alone. Live
 * standings ping nobody; the results ping each Entrant once, in the first message naming them.
 */
export const cupStandingsMessages = (v: StandingsView): ReadonlyArray<Payload> => {
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
        ...v.lateReads.map(({ pfid, at }) => {
          const name = escape(mapName(v.maps.find((m) => m.pfid === pfid) ?? { pfid, title: "" }));
          return at === null
            ? `${name} couldn't be read at the end (Steam didn't answer), so it stands on its last read before <t:${unix(v.week.endsAt)}:t>.`
            : `${name} was read late, at <t:${unix(at)}:t> (Steam was slow), so a time set after <t:${unix(v.week.endsAt)}:t> may count.`;
        }),
      ]
    : [
        `## Live standings · Weekly Cup, week of ${shortDate(v.week.opensAt)}`,
        `Read every 5 minutes until <t:${unix(v.week.endsAt)}:F>.`,
      ];
  const overallLines = [
    "**Overall**",
    ...overall.map(
      (o) =>
        `${o.place}. ${who(o.discordId)} · ${points(o.total)} pts${o.wins > 0 ? ` · ${o.wins} ${o.wins === 1 ? "win" : "wins"}` : ""}`,
    ),
  ];
  const perMap = maps.map((m, i) => {
    const map = v.maps.find((c) => c.pfid === m.pfid);
    const timed = m.rows.flatMap((r) =>
      r.ticks === null || r.rank === null ? [] : [{ ...r, ticks: r.ticks, rank: r.rank }],
    );
    const untimed = m.rows.filter((r) => r.ticks === null).map((r) => who(r.discordId));
    return [
      `**${i + 1}. ${map === undefined ? escape(m.title) : mapLink(map)}**`,
      ...timed
        .slice(0, MAP_ROWS)
        .map(
          (r) => `${r.rank}. ${who(r.discordId)} **${formatTime(r.ticks)}** · ${points(r.points)}`,
        ),
      ...(timed.length > MAP_ROWS ? [`and ${timed.length - MAP_ROWS} more`] : []),
      ...listLines(v.final ? "No time: " : "No time yet: ", untimed),
    ];
  });
  const parts = packed([head, overallLines, ...perMap]);
  if (!v.final) return parts.map((content) => ({ content, components: [], ...quiet }));
  const pinged = new Set<string>();
  return parts.map((content) => {
    const named = [...content.matchAll(/<@(\d+)>/g)].flatMap(([, id]) =>
      id === undefined || pinged.has(id) ? [] : [id],
    );
    for (const id of named) pinged.add(id);
    return { content, components: [], allowedMentions: { users: [...new Set(named)] } };
  });
};

/** A list as lines that start `prefix`, each well under a message, split between items. */
const listLines = (prefix: string, items: ReadonlyArray<string>): Array<string> => {
  const lines: Array<string> = [];
  let line = "";
  for (const item of items) {
    if (line !== "" && line.length + item.length + 2 > CONTENT_LIMIT / 2) {
      lines.push(line);
      line = "";
    }
    line = line === "" ? `${prefix}${item}` : `${line}, ${item}`;
  }
  if (line !== "") lines.push(line);
  return lines;
};

/**
 * Sections (each a list of lines) packed into messages of at most 2,000 characters: a section
 * goes whole into the current message if it fits, else starts the next, and one too long for any
 * message is split between its lines. Sections are a blank line apart.
 */
const packed = (sections: ReadonlyArray<ReadonlyArray<string>>): Array<string> => {
  const parts: Array<string> = [];
  let part = "";
  const add = (text: string, gap: string) => {
    if (part === "") part = text;
    else if (part.length + gap.length + text.length <= CONTENT_LIMIT) part += gap + text;
    else {
      parts.push(part);
      part = text;
    }
  };
  for (const section of sections) {
    const block = section.join("\n");
    if (block.length <= CONTENT_LIMIT) add(block, "\n\n");
    else section.forEach((line, i) => add(line, i === 0 ? "\n\n" : "\n"));
  }
  if (part !== "") parts.push(part);
  return parts;
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
