// PROTOTYPE (grill-design, never merged): posts each variant of the Daily post into the sandbox
// channel as the dev bot, each with its thread. Real data: Daily #60, "the drop", 2026-10-18.
// Run: pnpm tsx scripts/proto-daily/post.ts [A B C D E]
import { readFileSync } from "node:fs";
import { REST, Routes } from "discord.js";
import { readSandbox } from "../sandbox/config.js";

const dir = "scripts/proto-daily";
const file = (name: string) => ({ name, data: readFileSync(`${dir}/${name}`) });
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);
const channel =
  process.argv.find((a) => a.startsWith("--channel="))?.slice(10) ?? readSandbox()!.channelId;

const day = {
  n: 60,
  date: "Sun 18 Oct",
  title: "the drop",
  maker: "AvgRon",
  pfid: "3796494598",
  ends: 1792371600,
  starts: 1792285200,
  players: 145,
  lead: "0:08.532",
  leaders: "airman, snayK",
  podium: ["🥇 **airman** 0:08.532", "🥇 **snayK** 0:08.532", "🥉 **FEDUS** 0:08.566"],
  author: "0:08.911",
  gold: "0:09.000",
  silver: "0:11.000",
  bronze: "0:14.000",
};
const steam = `https://steamcommunity.com/sharedfiles/filedetails/?id=${day.pfid}`;
const site = "https://ballestrecords.com/daily/2026-10-18";
const ACCENT = 0x9ee34b;
const NO_PINGS = { parse: [] };
const buttons = (extra: object[] = []) => ({
  type: 1,
  components: [
    { type: 2, style: 5, label: "Today's board", url: site },
    { type: 2, style: 5, label: "Steam Workshop", url: steam },
    ...extra,
  ],
});
const updated = `-# Updated <t:${Math.floor(Date.now() / 1000)}:R> · refreshes every few hours`;
const threadName = `Daily #${day.n} · ${day.title} · ${day.date}`;

type Variant = { label: string; body: object; files: { name: string; data: Buffer }[] };

// Round 1 verdict: C, with the screenshot big and the spinning GIF beside the stats.
// Round 2 asks what the stats beside the GIF say; `--still` swaps the screenshot for our 3D still.
const hero = process.argv.includes("--still") ? "still.jpg" : "preview.jpg";
const card = (stats: string, foot: string): Variant["body"] => ({
  flags: 1 << 15,
  components: [
    {
      type: 17,
      accent_color: ACCENT,
      components: [
        {
          type: 10,
          content: `-# DAILY #${day.n} · ${day.date.toUpperCase()}\n# ${day.title}\nby **${day.maker}** · ends <t:${day.ends}:R>`,
        },
        { type: 12, items: [{ media: { url: `attachment://${hero}` } }] },
        {
          type: 9,
          components: [{ type: 10, content: stats }],
          accessory: { type: 11, media: { url: "attachment://spin.gif" } },
        },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `${foot}\n${updated}` },
        buttons(),
      ],
    },
  ],
});
const files = () => [file(hero), file("spin.gif")];
const medals = `Author ${day.author} · Gold ${day.gold} · Silver ${day.silver} · Bronze ${day.bronze}`;
const V: Record<string, Variant> = {
  A: {
    label: "A · Podium",
    files: files(),
    body: card(
      `**${day.players}** players · fastest **${day.lead}**\n${day.podium.join("\n")}`,
      medals,
    ),
  },
  B: {
    label: "B · Leader and the chase",
    files: files(),
    body: card(
      `### ${day.lead}\n**${day.leaders}** share the lead\n3rd **FEDUS** is 0.034 s back`,
      `**${day.players}** players · **138** beat the Author time (${day.author})`,
    ),
  },
  C: {
    label: "C · Top 5 table",
    files: files(),
    body: card(
      "```\n1  airman        0:08.532\n1  snayK         0:08.532\n3  FEDUS         0:08.566\n4  Borgmajster   0:08.578\n5  Water         0:08.583\n```",
      `**${day.players}** players · ${medals}`,
    ),
  },
  D: {
    label: "D · Numbers only, no names",
    files: files(),
    body: card(
      `**Players** ${day.players}\n**Fastest** ${day.lead}\n**Beat the Author** 138\n**Ends** <t:${day.ends}:t>`,
      medals,
    ),
  },
  E: {
    label: "E · Medal ladder",
    files: files(),
    body: card(
      `🏁 **${day.lead}** by ${day.leaders}\n**Author** ${day.author} · 138 players\n**Gold** ${day.gold} · 0\n**Silver** ${day.silver} · 6\n**Bronze** ${day.bronze} · 0`,
      `**${day.players}** players so far`,
    ),
  },
};

// Round 2 verdict: A (podium), the Workshop screenshot, a thread post when the lead changes, no
// ping, no GIF without a 3D file. Round 3: the lead-change post, and the card once the Daily closes.
const say = (content: string, where = channel) =>
  rest.post(Routes.channelMessages(where), { body: { content, allowed_mentions: NO_PINGS } });
const site100 = `${site}`;
const leadVariants: [string, object][] = [
  ["A · One line", { content: `🏁 **airman** takes the lead: **0:08.532**` }],
  [
    "B · Who it was taken from",
    { content: `🏁 **airman** takes the lead from **FEDUS**\n0:08.566 → **0:08.532** (−0.034 s)` },
  ],
  [
    "C · Small card",
    {
      flags: 1 << 15,
      components: [
        {
          type: 17,
          accent_color: ACCENT,
          components: [
            { type: 10, content: `-# NEW LEADER\n## airman · 0:08.532\n0.034 s faster than FEDUS` },
            { type: 1, components: [{ type: 2, style: 5, label: "Today's board", url: site100 }] },
          ],
        },
      ],
    },
  ],
  [
    "D · With how long the old lead held",
    {
      content: `🏁 **airman** takes the lead: **0:08.532**, 0.034 s under **FEDUS**, who held it for 3h 12m`,
    },
  ],
  [
    "E · Quiet log line",
    { content: `-# <t:${Math.floor(Date.now() / 1000)}:t> · lead: **airman** 0:08.532 (−0.034 s)` },
  ],
];
const tie = { content: `🤝 **snayK** ties the lead: **0:08.532**, level with **airman**` };

const closedCard = (
  head: string,
  stats: string,
  foot: string,
  opts: { accent?: number; media?: boolean } = {},
) => ({
  flags: 1 << 15,
  components: [
    {
      type: 17,
      accent_color: opts.accent ?? ACCENT,
      components: [
        { type: 10, content: head },
        ...(opts.media === false
          ? []
          : [{ type: 12, items: [{ media: { url: "attachment://preview.jpg" } }] }]),
        opts.media === false
          ? { type: 10, content: stats }
          : {
              type: 9,
              components: [{ type: 10, content: stats }],
              accessory: { type: 11, media: { url: "attachment://spin.gif" } },
            },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: foot },
        buttons(),
      ],
    },
  ],
});
const finalPodium = "🥇 **airman** 0:08.532\n🥇 **snayK** 0:08.532\n🥉 **FEDUS** 0:08.566";
const closedAt = `-# Closed <t:${day.ends}:f> · final`;
const closedVariants: [string, object, boolean][] = [
  [
    "A · Same card, marked Final",
    closedCard(
      `-# DAILY #${day.n} · ${day.date.toUpperCase()} · FINAL\n# ${day.title}\nby **${day.maker}** · ended <t:${day.ends}:R>`,
      `**${day.players}** players · won in **${day.lead}**\n${finalPodium}`,
      `${medals}\n${closedAt}`,
    ),
    true,
  ],
  [
    "B · Winner as the headline",
    closedCard(
      `-# DAILY #${day.n} · ${day.date.toUpperCase()} · ${day.title} by ${day.maker}\n# 🏆 airman & snayK win\n**0:08.532**, out of **${day.players}** players`,
      finalPodium,
      `${medals}\n${closedAt}`,
    ),
    true,
  ],
  [
    "C · Collapsed: pictures dropped",
    closedCard(
      `-# DAILY #${day.n} · ${day.date.toUpperCase()} · FINAL\n### ${day.title} by ${day.maker}`,
      `**${day.players}** players\n${finalPodium}`,
      closedAt,
      { media: false },
    ),
    false,
  ],
  [
    "D · Greyed out, points to the next Daily",
    closedCard(
      `-# DAILY #${day.n} · ${day.date.toUpperCase()} · CLOSED\n# ${day.title}\nby **${day.maker}**`,
      `**${day.players}** players · won in **${day.lead}**\n${finalPodium}`,
      `Today's Daily is up: **Daily #61** ↓\n${closedAt}`,
      { accent: 0x4a5070 },
    ),
    true,
  ],
  [
    "E · Unchanged, footer says Final",
    closedCard(
      `-# DAILY #${day.n} · ${day.date.toUpperCase()}\n# ${day.title}\nby **${day.maker}** · ended <t:${day.ends}:R>`,
      `**${day.players}** players · fastest **${day.lead}**\n${day.podium.join("\n")}`,
      `${medals}\n-# Final · the board closed <t:${day.ends}:R>`,
    ),
    true,
  ],
];

if (process.argv.includes("--round3")) {
  await say("**══ ROUND 3 · Q1: the post in the thread when the lead changes ══**");
  const live = (await rest.post(Routes.channelMessages(channel), {
    body: { ...V.A!.body, allowed_mentions: NO_PINGS },
    files: [file("preview.jpg"), file("spin.gif")],
  })) as { id: string };
  const thread = (await rest.post(Routes.threads(channel, live.id), {
    body: { name: threadName, auto_archive_duration: 1440 },
  })) as { id: string };
  for (const [label, body] of leadVariants) {
    await say(`**── PROTOTYPE ${label} ──**`, thread.id);
    await rest.post(Routes.channelMessages(thread.id), {
      body: { ...body, allowed_mentions: NO_PINGS },
    });
  }
  await say("**── A tie, in whichever style wins ──**", thread.id);
  await rest.post(Routes.channelMessages(thread.id), {
    body: { ...tie, allowed_mentions: NO_PINGS },
  });
  await say("**══ ROUND 3 · Q2: the card once the Daily closes ══**");
  for (const [label, body, media] of closedVariants) {
    await say(`**── PROTOTYPE ${label} ──**`);
    await rest.post(Routes.channelMessages(channel), {
      body: { ...body, allowed_mentions: NO_PINGS },
      files: media ? [file("preview.jpg"), file("spin.gif")] : [],
    });
  }
  console.log("round 3 posted; thread", thread.id);
  process.exit(0);
}

const keys = process.argv.slice(2).filter((a) => !a.startsWith("--"));
for (const k of keys.length ? keys : Object.keys(V)) {
  const v = V[k]!;
  await rest.post(Routes.channelMessages(channel), {
    body: { content: `**── PROTOTYPE ${v.label} ──**`, allowed_mentions: NO_PINGS },
  });
  const msg = (await rest.post(Routes.channelMessages(channel), {
    body: { ...v.body, allowed_mentions: NO_PINGS },
    files: v.files,
  })) as { id: string };
  await rest.post(Routes.threads(channel, msg.id), {
    body: { name: threadName, auto_archive_duration: 1440 },
  });
  console.log(`${k}: ${msg.id}`);
}
