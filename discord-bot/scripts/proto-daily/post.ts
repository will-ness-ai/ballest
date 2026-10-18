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
const V: Record<string, Variant> = {
  A: {
    label: "A · Embed card",
    files: [file("preview.jpg"), file("spin.gif")],
    body: {
      embeds: [
        {
          color: ACCENT,
          author: { name: `Daily #${day.n} · ${day.date}` },
          title: day.title,
          url: site,
          description: `by **${day.maker}** · ends <t:${day.ends}:R>`,
          thumbnail: { url: "attachment://spin.gif" },
          image: { url: "attachment://preview.jpg" },
          fields: [
            { name: "Fastest", value: `**${day.lead}**\n${day.leaders}`, inline: true },
            { name: "Players", value: `**${day.players}**`, inline: true },
            { name: "Medals", value: `Author ${day.author}\nGold ${day.gold}`, inline: true },
          ],
          footer: { text: "Updated every Refresh" },
          timestamp: new Date().toISOString(),
        },
      ],
      components: [buttons()],
    },
  },
  B: {
    label: "B · Text + two-up gallery",
    files: [file("preview.jpg"), file("spin.gif")],
    body: {
      content: [
        `## Daily #${day.n} · ${day.date}`,
        `### [${day.title}](<${steam}>) by ${day.maker}`,
        `Ends <t:${day.ends}:R> · **${day.players}** players so far`,
        `Fastest **${day.lead}** · ${day.leaders}`,
        `Author ${day.author} · Gold ${day.gold} · Silver ${day.silver} · Bronze ${day.bronze}`,
        updated,
      ].join("\n"),
      components: [buttons()],
    },
  },
  C: {
    label: "C · Card (Components V2)",
    files: [file("preview.jpg"), file("spin.gif")],
    body: {
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
            { type: 12, items: [{ media: { url: "attachment://spin.gif" } }] },
            {
              type: 9,
              components: [
                {
                  type: 10,
                  content: `**${day.players}** players · fastest **${day.lead}**\n${day.podium.join("\n")}`,
                },
              ],
              accessory: { type: 11, media: { url: "attachment://preview.jpg" } },
            },
            { type: 14, divider: true, spacing: 1 },
            {
              type: 10,
              content: `Author ${day.author} · Gold ${day.gold} · Silver ${day.silver} · Bronze ${day.bronze}\n${updated}`,
            },
            buttons(),
          ],
        },
      ],
    },
  },
  D: {
    label: "D · Drawn banner + spin",
    files: [file("banner.png"), file("spin.gif")],
    body: {
      content: `**Daily #${day.n}** is up: **${day.title}** by ${day.maker}. Ends <t:${day.ends}:R>.\n${updated}`,
      components: [buttons()],
    },
  },
  E: {
    label: "E · Spin first, minimal",
    files: [file("spin.gif")],
    body: {
      content: [
        `# ${day.title}`,
        `Daily #${day.n} · ${day.date} · by ${day.maker} · ends <t:${day.ends}:R>`,
        `-# ${day.players} players · fastest ${day.lead} (${day.leaders}) · updated <t:${Math.floor(Date.now() / 1000)}:R>`,
      ].join("\n"),
      components: [buttons()],
    },
  },
};

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
