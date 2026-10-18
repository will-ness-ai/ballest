// PROTOTYPE (grill-design, never merged): round 2, A (channel card) against forum variants that
// carry the Map's Workshop tags. Each variant gets its own channel in the test server, made here,
// and the same five real Maps (maps.json, as Steam and the site had them on 18 Oct), oldest first.
// Only Slick Slide has a spinning GIF; record lines are Slick Slide's real record holders at
// made-up Refresh times. Run: pnpm tsx scripts/proto-new-tracks/round2.ts [A B C D E]
import { readFileSync } from "node:fs";
import { REST, Routes } from "discord.js";

const dir = "scripts/proto-new-tracks";
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);
const admin = new REST({ version: "10" }).setToken(process.env.ADMIN_DISCORD_TOKEN!);
const GUILD = process.env.DISCORD_GUILD_ID!;
const ACCENT = 0x9ee34b;
const NO_PINGS = { parse: [] };
const t = (s: number, style = "R") => `<t:${s}:${style}>`;

type MapData = {
  pfid: string;
  title: string;
  published: number;
  maker: string;
  record: string;
  runs: string;
  medals: string[];
  podium: [string, string][];
  tags: string[];
};
const maps = (JSON.parse(readFileSync(`${dir}/maps.json`, "utf8")) as MapData[]).sort(
  (a, b) => a.published - b.published,
);
const refreshed = 1792334400;

const DIFFICULTY = ["beginner", "medium", "advanced", "expert"];
const STYLES = ["speed", "precision", "flow", "tech", "pathfinding", "climb", "balance", "ninja",
  "endurance", "puzzle", "downhill", "mini", "troll", "practice", "rubber", "vents"];
const WORKSHOP_TAGS = [...DIFFICULTY, ...STYLES]; // 20, Discord's most per forum
/** The difficulty first, then styles in the Map's own order: Discord's most per post is 5. */
const picked = (m: MapData) =>
  [...m.tags.filter((x) => DIFFICULTY.includes(x)), ...m.tags.filter((x) => STYLES.includes(x))].slice(0, 5);
const STATUS = ["No times yet", "Author unbeaten", "Author beaten", "🔥 New record"];

const steam = (pfid: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${pfid}`;
const site = (pfid: string) => `https://ballestrecords.com/map/${pfid}`;
const buttons = (m: MapData) => ({
  type: 1,
  components: [
    { type: 2, style: 5, label: "Steam Workshop", url: steam(m.pfid) },
    { type: 2, style: 5, label: "Map page", url: site(m.pfid) },
  ],
});
const PLACES = ["🥇", "🥈", "🥉"];
const stats = (m: MapData) =>
  `**${m.runs}** runs · record **${m.record}**\n${m.podium.map(([n, tm], i) => `${PLACES[i]} **${n}** ${tm}`).join("\n")}`;
const medals = (m: MapData) =>
  `Author ${m.medals[0]} · Gold ${m.medals[1]} · Silver ${m.medals[2]} · Bronze ${m.medals[3]}`;
const foot = (m: MapData) => `${medals(m)}\n-# Updated ${t(refreshed)} · with each Refresh`;
const text = (content: string) => ({ type: 10, content });
const divider = { type: 14, divider: true, spacing: 1 };
const gallery = (name: string) => ({ type: 12, items: [{ media: { url: `attachment://${name}` } }] });
const card = (inner: object[]) => ({
  flags: 1 << 15,
  allowed_mentions: NO_PINGS,
  components: [{ type: 17, accent_color: ACCENT, components: inner }],
});
const isSlick = (m: MapData) => m.pfid === "3821728582";
const files = (m: MapData) => [
  { name: "preview.jpg", data: readFileSync(`${dir}/p${m.pfid}.jpg`) },
  ...(isSlick(m) ? [{ name: "spin.gif", data: readFileSync(`${dir}/spin.gif`) }] : []),
];
/** The podium, with the spinning GIF beside it when the Map has one. */
const podium = (m: MapData) =>
  isSlick(m)
    ? { type: 9, components: [text(stats(m))], accessory: { type: 11, media: { url: "attachment://spin.gif" } } }
    : text(stats(m));
const fullCard = (m: MapData, head: string) =>
  card([text(head), gallery("preview.jpg"), podium(m), divider, text(foot(m)), buttons(m)]);

const recordLines = [
  `-# by the ${t(1792274400, "t")} Refresh · 🏁 **xMetzger** sets the first time: **0:22.322**`,
  `-# by the ${t(1792303200, "t")} Refresh · 🏁 **Solo Player** takes the record from **xMetzger**, who held it for 8h · 0:22.322 → **0:19.687** (−2.635 s)`,
  `-# by the ${t(1792332000, "t")} Refresh · 🏁 **Nikarus** takes the record from **Solo Player**, who held it for 8h · 0:19.687 → **0:18.907** (−0.780 s)`,
];
const linesFor = (m: MapData) =>
  isSlick(m)
    ? recordLines
    : [`-# by the ${t(m.published + 3 * 3600, "t")} Refresh · 🏁 **${m.podium[0]![0]}** sets the record: **${m.record}**`];

type Forum = { layout: 1 | 2; sort: 0 | 1; tags: string[] };
type Variant = {
  label: string;
  forum?: Forum;
  title?: (m: MapData) => string;
  tagsFor?: (m: MapData) => string[];
  body: (m: MapData) => object;
};

const V: Record<string, Variant> = {
  A: {
    label: "A · Channel card with the tags in its header",
    body: (m) =>
      fullCard(
        m,
        `-# NEW MAP · ${picked(m).join(" · ").toUpperCase()}\n# ${m.title}\nby **${m.maker}** · published ${t(m.published)}`,
      ),
  },
  B: {
    label: "B · Forum list: Workshop tags, title is the Map's name, full card inside",
    forum: { layout: 1, sort: 1, tags: WORKSHOP_TAGS },
    title: (m) => m.title,
    tagsFor: picked,
    body: (m) => fullCard(m, `by **${m.maker}** · published ${t(m.published)}`),
  },
  C: {
    label: "C · Forum list: the title carries the record (renamed each Refresh), compact card, a new record bumps the post",
    forum: { layout: 1, sort: 0, tags: WORKSHOP_TAGS },
    title: (m) => `${m.title} · ${m.record} ${m.podium[0]![0]}`,
    tagsFor: picked,
    body: (m) =>
      card([
        {
          type: 9,
          components: [text(`by **${m.maker}** · published ${t(m.published)}\n${stats(m)}\n-# ${medals(m)}`)],
          accessory: { type: 11, media: { url: "attachment://preview.jpg" } },
        },
        buttons(m),
      ]),
  },
  D: {
    label: "D · Forum gallery: big screenshot tiles, Workshop tags",
    forum: { layout: 2, sort: 1, tags: WORKSHOP_TAGS },
    title: (m) => `${m.title} by ${m.maker}`,
    tagsFor: picked,
    body: (m) => fullCard(m, `published ${t(m.published)}`),
  },
  E: {
    label: "E · Forum list: difficulty plus live status tags the bot keeps current",
    forum: { layout: 1, sort: 0, tags: [...DIFFICULTY, ...STATUS] },
    title: (m) => m.title,
    tagsFor: (m) => [
      ...m.tags.filter((x) => DIFFICULTY.includes(x)),
      m.record < m.medals[0]! ? "Author beaten" : "Author unbeaten",
      ...(isSlick(m) ? ["🔥 New record"] : []),
    ],
    body: (m) => fullCard(m, `by **${m.maker}** · published ${t(m.published)}`),
  },
};

const say = (where: string, content: string) =>
  rest.post(Routes.channelMessages(where), { body: { content, allowed_mentions: NO_PINGS } });

const keys = process.argv.slice(2).filter((a) => /^[A-Z]$/.test(a));
for (const key of keys.length ? keys : Object.keys(V)) {
  const v = V[key]!;
  const made = (await admin.post(Routes.guildChannels(GUILD), {
    body: v.forum
      ? {
          name: `r2-${key.toLowerCase()}-forum`,
          type: 15,
          topic: v.label,
          default_forum_layout: v.forum.layout,
          default_sort_order: v.forum.sort,
          available_tags: v.forum.tags.map((name) => ({ name })),
        }
      : { name: `r2-${key.toLowerCase()}-channel`, type: 0, topic: v.label },
  })) as { id: string; available_tags?: { id: string; name: string }[] };
  const tagId = new Map((made.available_tags ?? []).map((x) => [x.name, x.id]));
  for (const m of maps) {
    if (v.forum) {
      const post = (await rest.post(Routes.threads(made.id), {
        body: { name: v.title!(m), applied_tags: v.tagsFor!(m).map((x) => tagId.get(x)!), message: v.body(m) },
        files: files(m),
      })) as { id: string };
      for (const line of linesFor(m)) await say(post.id, line);
    } else {
      const msg = (await rest.post(Routes.channelMessages(made.id), { body: v.body(m), files: files(m) })) as { id: string };
      const thread = (await rest.post(Routes.threads(made.id, msg.id), {
        body: { name: `${m.title} · by ${m.maker}` },
      })) as { id: string };
      for (const line of linesFor(m)) await say(thread.id, line);
    }
  }
  console.log(key, made.id);
}
