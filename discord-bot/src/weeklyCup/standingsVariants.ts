// PROTOTYPE (branch claude/prototype-cup-standings): five looks for the Weekly Cup's standings,
// A to E, over one sample week, posted side by side by scripts/cup-standings-variants.ts for the
// organisers to pick from. Names stand in for mentions so the sandbox shows them; the chosen look
// replaces `cupStandingsMessages` in messages.ts, and this file goes.
import {
  AttachmentBuilder,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import { quiet, type Payload } from "../discord/messages.js";
import { formatTime, SCORE_TICKS_PER_SECOND } from "../domain.js";
import { mapLink } from "../links.js";
import type { CupStandingsImage } from "../render/scenes.js";
import { type CupStandings, cupStandings } from "./points.js";

const CUP_GOLD = 0xf2c14e;

// ---------------------------------------------------------------- the sample week

/** Eight Entrants, in sign-up order. */
const NAMES = [
  "marblequeen",
  "rollo",
  "pebblewright",
  "sprocket",
  "tumbler",
  "QuickSilver",
  "nightowl",
  "Zed",
] as const;

/** The three Cup Maps, as the sandbox's live check voted them. */
const MAPS = [
  {
    pfid: "3810099846",
    title: "Crimson Flux",
    creator: "CoS",
    previewUrl:
      "https://images.steamusercontent.com/ugc/16508777602063881011/220AD5A8994CA97C0A202887B6876310F80AA90E/",
  },
  {
    pfid: "3796494598",
    title: "the drop",
    creator: "AvgRon",
    previewUrl:
      "https://images.steamusercontent.com/ugc/18293733087848093630/8241FF36E1474DE6C07A2C0331D57CCC8DBEA8A9/",
  },
  {
    pfid: "3762695115",
    title: "AJC4",
    creator: "Action Jackson",
    previewUrl:
      "https://images.steamusercontent.com/ugc/16438736057311524995/30256D14AC7AE23AD29EF3507AC878B5D00678F2/",
  },
] as const;

/** Each Map's counted bests in seconds, by name; a name missing has no time (DNF). */
const SECONDS: Record<string, Partial<Record<(typeof NAMES)[number], number>>> = {
  "3810099846": {
    marblequeen: 38.214,
    rollo: 38.902,
    pebblewright: 39.551,
    sprocket: 41.003,
    tumbler: 41.003,
    QuickSilver: 44.87,
  },
  "3796494598": {
    rollo: 26.118,
    marblequeen: 26.54,
    QuickSilver: 27.002,
    pebblewright: 27.99,
    nightowl: 29.431,
    tumbler: 31.25,
  },
  "3762695115": {
    pebblewright: 49.877,
    marblequeen: 50.105,
    nightowl: 51.66,
    rollo: 52.3,
    Zed: 58.004,
  },
};

/** Each Map's whole Steam board size, and each Entrant's place on it (for "12th of 340"). */
const BOARD: Record<string, { readonly size: number; readonly places: Record<string, number> }> = {
  "3810099846": {
    size: 214,
    places: {
      marblequeen: 4,
      rollo: 7,
      pebblewright: 11,
      sprocket: 19,
      tumbler: 19,
      QuickSilver: 41,
    },
  },
  "3796494598": {
    size: 340,
    places: {
      rollo: 2,
      marblequeen: 5,
      QuickSilver: 9,
      pebblewright: 12,
      nightowl: 33,
      tumbler: 58,
    },
  },
  "3762695115": {
    size: 127,
    places: { pebblewright: 3, marblequeen: 6, nightowl: 10, rollo: 14, Zed: 62 },
  },
};

export interface Sample {
  readonly names: ReadonlyArray<string>;
  readonly maps: typeof MAPS;
  readonly standings: CupStandings;
  /** An Entrant's place on a Map's whole Steam board, and its size. */
  readonly board: (pfid: string, name: string) => { place: number; size: number } | null;
}

export const sample = (): Sample => {
  const times = Object.fromEntries(
    Object.entries(SECONDS).map(([pfid, byName]) => [
      pfid,
      Object.fromEntries(
        Object.entries(byName).map(([name, s]) => [name, Math.round(s * SCORE_TICKS_PER_SECOND)]),
      ),
    ]),
  );
  return {
    names: NAMES,
    maps: MAPS,
    standings: cupStandings(MAPS, NAMES, times),
    board: (pfid, name) => {
      const b = BOARD[pfid];
      const place = b?.places[name];
      return b === undefined || place === undefined ? null : { place, size: b.size };
    },
  };
};

// ---------------------------------------------------------------- shared bits

const pts = (n: number) => n.toLocaleString("en-US");
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const wins = (n: number) => (n === 0 ? "" : ` · ${n} ${n === 1 ? "win" : "wins"}`);
const MEDAL = ["🥇", "🥈", "🥉"];
const HEAD = "Weekly Cup · week of Mon, Oct 26";
const READ = "Read every 5 minutes until Sun, Nov 1, 8:00 PM";
const tag = (letter: string, what: string) => `-# Variant ${letter}: ${what}`;
const text = (content: string): Payload => ({ content, components: [], ...quiet });

// ---------------------------------------------------------------- A: one text table

/** A: the whole week as one monospace table, a row per Entrant, a column per Cup Map. */
export const variantA = ({ maps, standings }: Sample): ReadonlyArray<Payload> => {
  const short = (t: string) => (t.length > 12 ? `${t.slice(0, 11)}…` : t);
  const cell = (ticks: number | null, rank: number | null) =>
    ticks === null || rank === null ? "—" : `${formatTime(ticks).replace(/^0:/, "")} (${rank})`;
  const head = ["#", "Player", "Points", ...maps.map((m) => short(m.title))];
  const rows = standings.overall.map((o) => [
    String(o.place),
    o.discordId,
    pts(o.total),
    ...standings.maps.map((m) => {
      const r = m.rows.find((x) => x.discordId === o.discordId);
      return cell(r?.ticks ?? null, r?.rank ?? null);
    }),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: ReadonlyArray<string>) =>
    r
      .map((c, i) => (i === 2 || i === 0 ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0)))
      .join("  ");
  return [
    text(
      [
        tag("A", "one text table"),
        `## Live standings · ${HEAD}`,
        READ,
        "```",
        line(head),
        widths.map((w) => "─".repeat(w)).join("  "),
        ...rows.map(line),
        "```",
        "-# time (place on the Map) · — no time yet",
      ].join("\n"),
    ),
  ];
};

// ---------------------------------------------------------------- B: per Map, plus the total

/** B: the total first, then a section per Cup Map, each row with the Entrant's Steam board place. */
export const variantB = ({ maps, standings, board }: Sample): ReadonlyArray<Payload> => {
  const total = [
    "**Overall**",
    ...standings.overall.map(
      (o) => `${o.place}. **${o.discordId}** · ${pts(o.total)} pts${wins(o.wins)}`,
    ),
  ];
  const perMap = standings.maps.map((m, i) => {
    const map = maps[i] ?? maps[0];
    const timed = m.rows.filter((r) => r.ticks !== null && r.rank !== null);
    const none = m.rows.filter((r) => r.ticks === null).map((r) => r.discordId);
    return [
      `**${i + 1}. ${mapLink(map)}**`,
      ...timed.map((r) => {
        const b = board(m.pfid, r.discordId);
        return `${r.rank}. ${r.discordId} **${formatTime(r.ticks ?? 0)}** · ${pts(r.points)}${b === null ? "" : ` · *${ordinal(b.place)} of ${b.size} on Steam*`}`;
      }),
      ...(none.length > 0 ? [`No time yet: ${none.join(", ")}`] : []),
    ];
  });
  return [
    text(
      [
        tag(
          "B",
          "per-Map sections plus the total, with each Entrant's place on the whole Steam board",
        ),
        `## Live standings · ${HEAD}`,
        READ,
        "",
        total.join("\n"),
        "",
        perMap.map((s) => s.join("\n")).join("\n\n"),
      ].join("\n"),
    ),
  ];
};

// ---------------------------------------------------------------- C: Components V2 containers

/** C: a gold container for the total, and one per Cup Map with its picture. */
export const variantC = ({ maps, standings }: Sample): ReadonlyArray<Payload> => {
  const overall = new ContainerBuilder()
    .setAccentColor(CUP_GOLD)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [tag("C", "Components V2 containers"), `## Live standings · ${HEAD}`, `-# ${READ}`].join(
          "\n",
        ),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        standings.overall
          .map(
            (o, i) =>
              `${MEDAL[i] ?? `\`${String(o.place).padStart(2)}\``} **${o.discordId}** · ${pts(o.total)} pts${wins(o.wins)}`,
          )
          .join("\n"),
      ),
    );
  const perMap = standings.maps.map((m, i) => {
    const map = maps[i] ?? maps[0];
    const timed = m.rows.filter((r) => r.ticks !== null && r.rank !== null);
    const none = m.rows.filter((r) => r.ticks === null).map((r) => r.discordId);
    return new ContainerBuilder().addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            [
              `### ${i + 1}. ${mapLink(map)}`,
              `-# by ${map.creator}`,
              ...timed.map(
                (r) =>
                  `${MEDAL[(r.rank ?? 9) - 1] ?? `\`${r.rank}.\``} ${r.discordId} **${formatTime(r.ticks ?? 0)}** · ${pts(r.points)}`,
              ),
              ...(none.length > 0 ? [`-# No time yet: ${none.join(", ")}`] : []),
            ].join("\n"),
          ),
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(map.previewUrl)),
    );
  });
  return [
    {
      flags: MessageFlags.IsComponentsV2,
      components: [overall, ...perMap],
      ...quiet,
    } as Payload,
  ];
};

// ---------------------------------------------------------------- D: an image

/** D's picture's input: the total and each Map's top rows, drawn by the Renderer. */
export const variantDImage = ({ maps, standings }: Sample): CupStandingsImage => ({
  title: "Weekly Cup",
  subtitle: "Week of Mon, Oct 26 · live standings",
  maps: maps.map((m) => m.title),
  rows: standings.overall.map((o) => ({
    place: o.place,
    name: o.discordId,
    total: o.total,
    wins: o.wins,
    cells: standings.maps.map((m) => {
      const r = m.rows.find((x) => x.discordId === o.discordId);
      return r?.ticks == null || r.rank === null
        ? null
        : { time: formatTime(r.ticks).replace(/^0:/, ""), rank: r.rank };
    }),
  })),
});

/** D: the image, with the Maps' links under it. */
export const variantD = (sampled: Sample, png: Uint8Array): ReadonlyArray<Payload> => [
  {
    content: [
      tag("D", "an image drawn by the Renderer"),
      `${READ}. Maps: ${sampled.maps.map((m) => mapLink(m)).join(" · ")}`,
    ].join("\n"),
    files: [new AttachmentBuilder(Buffer.from(png), { name: "cup-standings.png" })],
    components: [],
    ...quiet,
  },
];

// ---------------------------------------------------------------- E: compact, leader first

/** E: who leads and by how much, the top 3, and each Map's leader, in a few lines. */
export const variantE = ({ maps, standings }: Sample): ReadonlyArray<Payload> => {
  const [first, second] = standings.overall;
  const leader =
    first === undefined
      ? "Nobody has a time yet."
      : `🏆 **${first.discordId}** leads with **${pts(first.total)}** pts${wins(first.wins)}${second === undefined ? "" : `, ${pts(first.total - second.total)} ahead of ${second.discordId}`}.`;
  const top = standings.overall
    .slice(0, 3)
    .map((o, i) => `${MEDAL[i] ?? ""} ${o.discordId} ${pts(o.total)}`)
    .join("  ·  ");
  const rest = standings.overall.length - 3;
  const mapLines = standings.maps.map((m, i) => {
    const map = maps[i] ?? maps[0];
    const [a, b] = m.rows.filter((r) => r.ticks !== null);
    if (a?.ticks == null) return `${mapLink(map)}: no time yet`;
    const gap =
      b?.ticks == null
        ? ""
        : ` (+${((b.ticks - a.ticks) / SCORE_TICKS_PER_SECOND).toFixed(3)} ${b.discordId})`;
    return `${mapLink(map)}: **${a.discordId}** ${formatTime(a.ticks)}${gap}`;
  });
  return [
    text(
      [
        tag("E", "compact, leader first"),
        `**${HEAD}** · live`,
        leader,
        `${top}${rest > 0 ? `  ·  +${rest} more` : ""}`,
        ...mapLines,
        `-# ${READ}`,
      ].join("\n"),
    ),
  ];
};
