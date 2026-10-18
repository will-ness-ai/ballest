// PROTOTYPE (grill-design, never merged): posts each variant of the improved #new-tracks post into
// the test server's proto channels as the dev bot, each with its thread of record lines.
// Real data: "Slick Slide" by xMetzger (3821728582), published 17 Oct, as the site had it on
// 18 Oct; the record lines' Refresh times are made up but in the right order.
// Run: pnpm tsx scripts/proto-new-tracks/post.ts [A B C D E]
import { readFileSync } from "node:fs";
import { REST, Routes } from "discord.js";

const dir = "scripts/proto-new-tracks";
const file = (name: string) => ({ name, data: readFileSync(`${dir}/${name}`) });
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);
const CHANNEL = "1561484688663777370"; // #new-tracks-proto
const FORUM = "1561484690500616225"; // #new-tracks-forum-proto
const ACCENT = 0x9ee34b;
const NO_PINGS = { parse: [] };
const t = (s: number, style = "R") => `<t:${s}:${style}>`;

const map = {
  pfid: "3821728582",
  title: "Slick Slide",
  maker: "xMetzger",
  published: 1792264995,
  runs: 49,
  record: "0:18.907",
  podium: ["🥇 **Nikarus** 0:18.907", "🥈 **Solo Player** 0:19.687", "🥉 **warzone1320** 0:20.196"],
  medals: "Author 0:24.340 · Gold 0:26.000 · Silver 0:30.000 · Bronze 0:39.000",
};
const steam = (pfid: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${pfid}`;
const site = (pfid: string) => `https://ballestrecords.com/map/${pfid}`;
const buttons = {
  type: 1,
  components: [
    { type: 2, style: 5, label: "Steam Workshop", url: steam(map.pfid) },
    { type: 2, style: 5, label: "Map page", url: site(map.pfid) },
  ],
};
const refreshed = 1792334400; // a Refresh on 18 Oct
const header = `-# NEW MAP · SAT 17 OCT\n# ${map.title}\nby **${map.maker}** · published ${t(map.published)}`;
const stats = `**${map.runs}** runs · record **${map.record}**\n${map.podium.join("\n")}`;
const foot = `${map.medals}\n-# Updated ${t(refreshed)} · with each Refresh`;
const threadName = `${map.title} · by ${map.maker}`;

// The thread: one quiet line per record change, at Refresh resolution (Will: no 15-min reads).
const recordLines = [
  `-# by the ${t(1792274400, "t")} Refresh · 🏁 **xMetzger** sets the first time: **0:22.322**`,
  `-# by the ${t(1792303200, "t")} Refresh · 🏁 **Solo Player** takes the record from **xMetzger**, who held it for 8h · 0:22.322 → **0:19.687** (−2.635 s)`,
  `-# by the ${t(1792332000, "t")} Refresh · 🏁 **Nikarus** takes the record from **Solo Player**, who held it for 8h · 0:19.687 → **0:18.907** (−0.780 s)`,
];

const card = (inner: object[]) => ({
  flags: 1 << 15,
  allowed_mentions: NO_PINGS,
  components: [{ type: 17, accent_color: ACCENT, components: inner }],
});
const text = (content: string) => ({ type: 10, content });
const gallery = (name: string) => ({ type: 12, items: [{ media: { url: `attachment://${name}` } }] });
const divider = { type: 14, divider: true, spacing: 1 };
const section = (content: string, thumb: string) => ({
  type: 9,
  components: [text(content)],
  accessory: { type: 11, media: { url: thumb } },
});

type Variant = {
  label: string;
  body: object;
  files: { name: string; data: Buffer }[];
  forum?: boolean;
  thread?: string[];
};

// The digest's other Maps, as the site had them on 18 Oct.
const others = [
  ["3821786518", "lock in", "DirtWrittenPro", 1792270339, "0:25.200", "Action Jackson", 9, "https://images.steamusercontent.com/ugc/13250797698551484544/EEFD8AA115E069ED7E842F7C3A7CCD837A7C91AB/"],
  ["3821738025", "Amphitheater", "yaboi63", 1792265938, "1:07.624", "Gekkenman", 14, "https://images.steamusercontent.com/ugc/17597359294945054239/2DB75A89E0EF333682639438C24167C19F842EE2/"],
  ["3821670142", "Industry", "DpDP3DQ", 1792259550, "0:33.262", "DpDP3DQ", 8, "https://images.steamusercontent.com/ugc/15019557852888877343/A16FCFE33FF8127F1E6EA955258B12A2E45DBE50/"],
  ["3821651186", "Fih", "Lucid XO", 1792257846, "0:06.535", "Skylar <3", 12, "https://images.steamusercontent.com/ugc/16319478558809565888/64F4617A30C226C097A6AD062C7C16FBD1269E01/"],
] as const;

const V: Record<string, Variant> = {
  A: {
    label: "A · Daily twin: screenshot big, spinning GIF beside the podium",
    files: [file("preview.jpg"), file("spin.gif")],
    body: card([
      text(header),
      gallery("preview.jpg"),
      { type: 9, components: [text(stats)], accessory: { type: 11, media: { url: "attachment://spin.gif" } } },
      divider,
      text(foot),
      buttons,
    ]),
  },
  B: {
    label: "B · Compact: one row, screenshot as a thumbnail, no GIF",
    files: [file("preview.jpg")],
    body: card([
      section(
        `-# NEW MAP · by **${map.maker}** · published ${t(map.published)}\n### ${map.title}\nrecord **${map.record}** by **Nikarus** · ${map.runs} runs\n-# ${map.medals}`,
        "attachment://preview.jpg",
      ),
      buttons,
    ]),
  },
  C: {
    label: "C · The spinning GIF is the picture, no screenshot",
    files: [file("spin.gif")],
    body: card([text(header), gallery("spin.gif"), text(stats), divider, text(foot), buttons]),
  },
  D: {
    label: "D · Digest: one card per hour for every Map published in it",
    files: [file("preview.jpg")],
    body: card([
      text(`-# NEW MAPS · SAT 17 OCT · 18:00 – 19:00\n## 5 new maps this hour`),
      divider,
      section(
        `**[${map.title}](${site(map.pfid)})** by ${map.maker} · ${t(map.published, "t")}\nrecord **${map.record}** by Nikarus · ${map.runs} runs`,
        "attachment://preview.jpg",
      ),
      ...others.map(([pfid, title, maker, at, rec, wr, runs, img]) =>
        section(
          `**[${title}](${site(pfid)})** by ${maker} · ${t(at, "t")}\nrecord **${rec}** by ${wr} · ${runs} runs`,
          img,
        ),
      ),
      text(`-# Updated ${t(refreshed)} · with each Refresh`),
    ]),
    thread: [
      ...recordLines.map((l) => l.replace(/· 🏁/, `· **${map.title}** · 🏁`)),
      `-# by the ${t(1792332000, "t")} Refresh · **Amphitheater** · 🏁 **Gekkenman** takes the record from **yaboi63**, who held it for 5h · 1:12.010 → **1:07.624** (−4.386 s)`,
    ],
  },
  E: {
    label: "E · Forum channel: each Map is its own post, record lines inside it",
    forum: true,
    files: [file("preview.jpg"), file("spin.gif")],
    body: card([
      text(`by **${map.maker}** · published ${t(map.published)}`),
      gallery("preview.jpg"),
      { type: 9, components: [text(stats)], accessory: { type: 11, media: { url: "attachment://spin.gif" } } },
      divider,
      text(foot),
      buttons,
    ]),
  },
};

const send = (where: string, body: object, files: Variant["files"] = []) =>
  rest.post(Routes.channelMessages(where), { body, files }) as Promise<{ id: string }>;
const say = (where: string, content: string) =>
  send(where, { content, allowed_mentions: NO_PINGS });

const keys = process.argv.slice(2).filter((a) => /^[A-Z]$/.test(a));
for (const key of keys.length ? keys : Object.keys(V)) {
  const v = V[key]!;
  if (v.forum) {
    // A forum post's title is the Map's name; its first message is the card.
    const post = (await rest.post(Routes.threads(FORUM), {
      body: { name: threadName, message: v.body },
      files: v.files,
    })) as { id: string };
    for (const line of recordLines) await say(post.id, line);
    console.log(key, "forum post", post.id);
    continue;
  }
  await say(CHANNEL, `**${v.label}**`);
  const msg = await send(CHANNEL, v.body, v.files);
  const thread = (await rest.post(Routes.threads(CHANNEL, msg.id), {
    body: { name: key === "D" ? "New maps · Sat 17 Oct · 18:00" : threadName },
  })) as { id: string };
  for (const line of v.thread ?? recordLines) await say(thread.id, line);
  console.log(key, msg.id, thread.id);
}
