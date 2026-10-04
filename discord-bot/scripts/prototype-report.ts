// ================================================================ PROTOTYPE (daily report)
// Throwaway: posts each variant of the daily report to the sandbox channel as the dev bot, from
// today's script output (../scratch/post.json) and the last 24h of changes (../scratch/since.json).
//   node --import tsx scripts/prototype-report.ts <round> [variant..]
// Never merged; the winner is rebuilt in src/ by /implement-spec.
import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { REST, Routes } from "discord.js";
import { devEnvFile } from "./devEnv.js";
import { readSandbox } from "./sandbox/config.js";
import { Renderer } from "../src/render/renderer.js";
import type { El } from "../src/render/scenes.js";

// ---------------------------------------------------------------- data

interface Player {
  beaten: number;
  author: number;
  wr: number;
  top5: number;
  persona: string;
}
interface MapRow {
  pfid: string;
  title: string;
  created: number;
  finishers: number;
  author_medalists: number;
}
interface Post {
  generated_at: string;
  players: Record<string, Player>;
  maps: Array<MapRow>;
  oldest_records: Array<{ board: string; steam_id: string; score: number; set_at: string }>;
  oldest_workshop_records: Array<{ map: string; steam_id: string; score: number; set_at: string }>;
}
interface Change {
  new: string;
  old: string;
  score: number;
  old_score: number;
}
interface Since {
  new_maps: number;
  campaign_records: Array<Change & { track: string }>;
  workshop_records: Array<Change & { map: { pfid: string; title: string } }>;
  newly_beaten: Array<{ map: { pfid: string; title: string }; by: string; score: number }>;
  medals_claimed: Array<{ map: { pfid: string; title: string }; by: string }>;
}

const post = JSON.parse(readFileSync("../scratch/post.json", "utf8")) as Post;
const since = JSON.parse(readFileSync("../scratch/since.json", "utf8")) as Since;
const mapsById = new Map(post.maps.map((m) => [m.pfid, m]));
const TRACKS: Record<string, string> = {
  Map_Track18: "S1 06",
  Map_Track19: "S1 07",
  Map_Track_S2_Loopworks: "S2 06 Loopworks",
};

const TOP = 10;
const SITE = "https://ballest.willness.dev";
const WORKSHOP = "https://steamcommunity.com/sharedfiles/filedetails/?id=";
const now = new Date(post.generated_at);

const esc = (s: string) =>
  s.replace(/[\\*_~`|>[\]]/g, (c) => "\\" + c).replace(/@/g, "@​");
const time = (ticks: number) => {
  const s = ticks / 100000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
};
const gain = (a: number, b: number) => `-${((b - a) / 100000).toFixed(3)}s`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const ago = (iso: string) => Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
const link = (title: string, pfid: string) => `[${esc(title || pfid)}](<${WORKSHOP}${pfid}>)`;
const name = (sid: string) => post.players[sid]?.persona || sid;

type Stat = "beaten" | "author" | "wr" | "top5";
const ranked = (key: Stat, then?: Stat) =>
  Object.entries(post.players)
    .filter(([, p]) => p[key] > 0)
    .sort(([a, p], [b, q]) => q[key] - p[key] || (then ? q[then] - p[then] : 0) || (a < b ? -1 : 1))
    .slice(0, TOP)
    .map(([sid, p]) => ({ who: p.persona || sid, n: p[key] }));

const BOARDS: Array<{ title: string; key: Stat; then?: Stat; noun: string; emoji: string }> = [
  { title: "Most maps beaten", key: "beaten", noun: "maps", emoji: "🏁" },
  { title: "Most author medals", key: "author", noun: "medals", emoji: "🏅" },
  { title: "Most world records", key: "wr", then: "top5", noun: "records", emoji: "🥇" },
  { title: "Most top 5s", key: "top5", then: "wr", noun: "top 5s", emoji: "🖐️" },
];

const day1 = (m: MapRow) => now.getTime() / 1000 - m.created >= 86400;
const unbeaten = post.maps
  .filter((m) => day1(m) && m.finishers === 0)
  .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
const unclaimed = post.maps
  .filter((m) => day1(m) && m.finishers > 0 && m.author_medalists === 0)
  .sort((a, b) => b.finishers - a.finishers);
const players = Object.keys(post.players).length;
const headline = `${post.maps.length.toLocaleString("en")} Workshop maps · ${players.toLocaleString("en")} players · ${day(post.generated_at)}`;

// ---------------------------------------------------------------- sections as markdown lines

const SINCE_MAX = 5;
const sinceLines = (): Array<string> => {
  const out: Array<string> = [];
  for (const c of since.campaign_records)
    out.push(`- 🏆 **${esc(c.new)}** took ${c.track} from ${esc(c.old)} — ${time(c.score)} (${gain(c.score, c.old_score)})`);
  const ws = since.workshop_records;
  for (const c of ws.slice(0, SINCE_MAX))
    out.push(`- 🥇 **${esc(c.new)}** took ${link(c.map.title, c.map.pfid)} from ${esc(c.old)} — ${time(c.score)}`);
  if (ws.length > SINCE_MAX) out.push(`- …and ${ws.length - SINCE_MAX} more Workshop records changed hands`);
  for (const b of since.newly_beaten) out.push(`- 🎉 ${link(b.map.title, b.map.pfid)} beaten for the first time by **${esc(b.by)}**`);
  for (const c of since.medals_claimed) out.push(`- 🎯 **${esc(c.by)}** claimed the first author medal on ${link(c.map.title, c.map.pfid)}`);
  out.push(`- 🆕 ${since.new_maps} new maps on the Workshop`);
  return out;
};
const boardLines = (b: (typeof BOARDS)[number]) =>
  ranked(b.key, b.then).map((r, i) => `${i + 1}. **${esc(r.who)}** — ${r.n} ${b.noun}`);
const unbeatenLines = () => unbeaten.map((m) => `- ${link(m.title, m.pfid)}`);
const unclaimedLines = () =>
  unclaimed.map((m) => `- ${link(m.title, m.pfid)} — ${m.finishers} finisher${m.finishers === 1 ? "" : "s"}`);
const oldestLines = () =>
  post.oldest_records.map(
    (r, i) => `${i + 1}. **${esc(name(r.steam_id))}** — ${TRACKS[r.board] ?? r.board} in ${time(r.score)} — set ${day(r.set_at)} (${ago(r.set_at)} days)`,
  );
const oldestUgcLines = () =>
  post.oldest_workshop_records.map((r, i) => {
    const m = mapsById.get(r.map);
    return `${i + 1}. **${esc(name(r.steam_id))}** — ${link(m?.title ?? r.map, r.map)} in ${time(r.score)} — set ${day(r.set_at)} (${ago(r.set_at)} days)`;
  });
const FOOT = "Creators count on their own maps only by beating their own author time. Lists skip maps under a day old. Source: Steam leaderboards.";

const quote = (lines: Array<string>) => lines.map((l) => `> ${l}`).join("\n");

/** Pack sections (blank line between) into messages of at most `limit` chars. */
const pack = (sections: Array<string>, limit = 2000) => {
  const out: Array<string> = [];
  let cur = "";
  for (const s of sections) {
    const cand = cur ? `${cur}\n\n${s}` : s;
    if (cur && cand.length > limit) {
      out.push(cur);
      cur = s;
    } else cur = cand;
  }
  if (cur) out.push(cur);
  return out;
};

// ---------------------------------------------------------------- Discord

const env: Record<string, string> = {};
for (const line of readFileSync(devEnvFile(), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m?.[1]) env[m[1]] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
}
const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN!);
const channel = readSandbox()!.channelId;
const NO_PINGS = { parse: [] as Array<string> };

interface Out {
  content?: string;
  embeds?: Array<unknown>;
  components?: Array<unknown>;
  flags?: number;
  files?: Array<{ name: string; data: Buffer }>;
}
const send = async (to: string, m: Out) => {
  const { files, ...body } = m;
  return (await rest.post(Routes.channelMessages(to), {
    body: { ...body, allowed_mentions: NO_PINGS },
    ...(files ? { files } : {}),
  })) as { id: string };
};
const divider = (label: string) => send(channel, { content: `-# ━━━━━━━━  **${label}**  ━━━━━━━━` });

const draw = (scene: El, width: number) =>
  Effect.runPromise(
    Effect.scoped(Effect.flatMap(Renderer, (r) => r.scene(scene, width))).pipe(Effect.provide(Renderer.Default)),
  );

// ---------------------------------------------------------------- round 1: the post's format

const sections = () => [
  `# Custom Map Standings\n-# ${headline}`,
  `> ### 📅 Since yesterday\n${quote(sinceLines())}`,
  ...BOARDS.map((b) => `> ### ${b.emoji} ${b.title}\n${quote(boardLines(b))}`),
  `> ### 🚫 Unbeaten maps\n${quote(unbeatenLines())}`,
  `> ### 🎯 Author medals still unclaimed\n${quote(unclaimedLines())}`,
  `> ### 🕰️ Longest-standing campaign records\n${quote(oldestLines())}`,
  `> ### 🕰️ Longest-standing Workshop records\n${quote(oldestUgcLines())}`,
  `-# ${FOOT}`,
];

const LIME = 0x8be03c;

const round1: Record<string, { label: string; post: () => Promise<void> }> = {
  A: {
    label: "A · Split text",
    post: async () => {
      for (const content of pack(sections())) await send(channel, { content });
    },
  },
  B: {
    label: "B · Embeds",
    post: async () => {
      const field = (b: (typeof BOARDS)[number]) => ({
        name: `${b.emoji} ${b.title}`,
        value: ranked(b.key, b.then).map((r, i) => `\`${String(i + 1).padStart(2)}\` ${esc(r.who)} · **${r.n}**`).join("\n"),
        inline: true,
      });
      await send(channel, {
        embeds: [
          { title: "Custom Map Standings", url: SITE, description: `${headline}\n\n**📅 Since yesterday**\n${sinceLines().join("\n")}`, color: LIME },
          { title: "Standings", color: LIME, fields: [field(BOARDS[0]!), field(BOARDS[1]!), { name: "​", value: "​", inline: false }, field(BOARDS[2]!), field(BOARDS[3]!)] },
          {
            title: "Maps waiting on someone",
            color: 0xffd447,
            fields: [
              { name: "🚫 Unbeaten", value: unbeatenLines().join("\n").slice(0, 1024) },
              { name: "🎯 Author medal unclaimed", value: unclaimedLines().join("\n").slice(0, 1024) },
            ],
          },
          {
            title: "Longest-standing records",
            color: 0x58a8ff,
            fields: [
              { name: "🕰️ Campaign", value: oldestLines().join("\n") },
              { name: "🕰️ Workshop", value: oldestUgcLines().join("\n") },
            ],
            footer: { text: FOOT },
          },
        ],
      });
    },
  },
  C: {
    label: "C · Cards (components)",
    post: async () => {
      const text = (content: string) => ({ type: 10, content });
      const sep = { type: 14, divider: true, spacing: 1 };
      const twoCol = (a: (typeof BOARDS)[number], b: (typeof BOARDS)[number]) => {
        const ra = ranked(a.key, a.then), rb = ranked(b.key, b.then);
        const w = 17;
        const rows = ra.map((r, i) => {
          const s = rb[i];
          const cut = (x: string) => (x.length > w ? x.slice(0, w - 1) + "…" : x).replace(/`/g, "'");
          const left = `${String(i + 1).padStart(2)} ${cut(r.who).padEnd(w)} ${String(r.n).padStart(4)}`;
          return s ? `${left}   ${String(i + 1).padStart(2)} ${cut(s.who).padEnd(w)} ${String(s.n).padStart(4)}` : left;
        });
        const head = ` # ${a.title.replace("Most ", "").padEnd(w + 5)}    # ${b.title.replace("Most ", "")}`;
        return "```\n" + [head, ...rows].join("\n") + "\n```";
      };
      await send(channel, {
        flags: 1 << 15,
        components: [
          {
            type: 17,
            accent_color: LIME,
            components: [
              text(`# Custom Map Standings\n-# ${headline}`),
              sep,
              text(`### 📅 Since yesterday\n${sinceLines().join("\n")}`),
              sep,
              text(`### 🏁 Maps beaten · 🏅 author medals\n${twoCol(BOARDS[0]!, BOARDS[1]!)}`),
              text(`### 🥇 World records · top 5s\n${twoCol(BOARDS[2]!, BOARDS[3]!)}`),
            ],
          },
          { type: 1, components: [{ type: 2, style: 5, label: "Full standings on the site", url: SITE }] },
        ],
      });
      await send(channel, {
        flags: 1 << 15,
        components: [
          {
            type: 17,
            accent_color: 0xffd447,
            components: [
              text(`### 🚫 Unbeaten\n${unbeatenLines().join("\n")}\n### 🎯 Author medal unclaimed\n${unclaimedLines().join("\n")}`),
              sep,
              text(`### 🕰️ Longest-standing records\n${[...oldestLines(), ...oldestUgcLines().map((l, i) => l.replace(/^\d+\./, `${i + 4}.`))].join("\n")}`),
              text(`-# ${FOOT}`),
            ],
          },
        ],
      });
    },
  },
  D: {
    label: "D · Image + text",
    post: async () => {
      const box = (style: Record<string, string | number>, ...children: Array<El | string>): El => ({
        type: "div",
        props: { style: { display: "flex", ...style }, children },
      });
      const col = (b: (typeof BOARDS)[number]) =>
        box(
          { flexDirection: "column", width: 270, gap: 4 },
          box({ fontFamily: "Chakra Petch", fontWeight: 600, fontSize: 13, letterSpacing: 1.4, textTransform: "uppercase", color: "#93a2c8", marginBottom: 6 }, b.title),
          ...ranked(b.key, b.then).map((r, i) =>
            box(
              { alignItems: "center", gap: 8, fontSize: 15, padding: "3px 8px", borderRadius: 6, backgroundColor: i === 0 ? "rgba(139,224,60,0.16)" : "rgba(255,255,255,0.04)" },
              box({ width: 22, color: i < 3 ? "#ffd447" : "#63719a", fontFamily: "Chakra Petch", fontWeight: 700 }, String(i + 1)),
              box({ flexGrow: 1, overflow: "hidden" }, r.who.length > 20 ? r.who.slice(0, 19) + "…" : r.who),
              box({ fontFamily: "Chakra Petch", fontWeight: 700, color: "#eaf0ff" }, String(r.n)),
            ),
          ),
        );
      const scene = box(
        { flexDirection: "column", padding: 28, gap: 20, backgroundColor: "#0a1020", color: "#eaf0ff", fontFamily: "Archivo", borderRadius: 8 },
        box({ flexDirection: "column", gap: 4 }, box({ fontFamily: "Bungee", fontSize: 28 }, "Custom Map Standings"), box({ color: "#93a2c8", fontSize: 14 }, headline)),
        box({ gap: 24 }, col(BOARDS[0]!), col(BOARDS[1]!)),
        box({ gap: 24 }, col(BOARDS[2]!), col(BOARDS[3]!)),
      );
      const png = await draw(scene, 620);
      await send(channel, { content: `## 📅 Since yesterday\n${sinceLines().join("\n")}`, files: [{ name: "standings.png", data: Buffer.from(png) }] });
      for (const content of pack(sections().slice(6))) await send(channel, { content });
    },
  },
  E: {
    label: "E · Headline + thread",
    post: async () => {
      const head = await send(channel, {
        content: `# Custom Map Standings\n-# ${headline}\n### 📅 Since yesterday\n${sinceLines().join("\n")}\n-# Full standings in the thread ↓`,
      });
      const thread = (await rest.post(Routes.threads(channel, head.id), {
        body: { name: `Standings · ${day(post.generated_at)}`, auto_archive_duration: 1440 },
      })) as { id: string };
      for (const content of pack(sections().slice(2))) await send(thread.id, { content });
    },
  },
};

const [round = "1", ...picked] = process.argv.slice(2);
const variants = round === "1" ? round1 : {};
for (const key of picked.length ? picked : Object.keys(variants)) {
  const v = variants[key]!;
  await divider(v.label);
  await v.post();
  console.log(`posted ${v.label}`);
}
