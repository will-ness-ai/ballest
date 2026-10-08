// PROTOTYPE (grill-design, share images). Never merged: the winner is rebuilt by
// /implement-spec. Every page kind is first boiled down to one CardData, then each variant
// draws it: a player as a stat sheet (round 1's B), and a Map, Track or Daily as a poster
// carrying the stat sheet's tiles (round 1's D with B's information).
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import {
  getBoardPage,
  getBoardScores,
  getDaily,
  getDailyDates,
  getPlayer,
  getWorkshop,
} from "../../db/data";
import { CIRCUIT, TRACKS } from "../../lib/circuit";
import {
  SCORE_TICKS_PER_SECOND,
  fmtN,
  fmtSec,
  fmtTime,
  hueFor,
  personaOf,
  safeImg,
} from "../../lib/rules";

export const VARIANTS = {
  "1": "Bottom row",
  "2": "Split",
  "3": "Banner",
  "4": "Side column",
  "5": "Inline",
} as const;
export type Variant = keyof typeof VARIANTS;
export const KINDS = ["player", "map", "track", "daily"] as const;
export type Kind = (typeof KINDS)[number];

const C = {
  bg: "#0a1020",
  bg2: "#16244a",
  text: "#eaf0ff",
  dim: "#93a2c8",
  faint: "#63719a",
  gold: "#ffd447",
  author: "#5fd4ff",
  live: "#8be03c",
  line: "rgba(150,175,245,0.18)",
};

interface Stat {
  value: string;
  label: string;
  color?: string;
}
export interface CardData {
  kind: Kind;
  kicker: string;
  title: string;
  /* avatar, Map preview or Track screenshot (data: URL), or null */
  image: string | null;
  /* the picture a player's card can sit on: their best finish's Map or Track */
  backdrop: string | null;
  hue: number;
  headline: Stat;
  stats: Array<Stat>;
}

const ASSETS = join(process.cwd(), "og-assets");

async function remote(url: string | null | undefined) {
  const u = safeImg(url);
  if (!u) return null;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const type = r.headers.get("content-type") ?? "image/jpeg";
    if (type.includes("webp")) return null;
    return `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

async function trackShot(board: string) {
  try {
    const b = await readFile(join(ASSETS, board + ".jpg"));
    return "data:image/jpeg;base64," + b.toString("base64");
  } catch {
    return null;
  }
}

const fullAvatar = (u: string | null | undefined) => u?.replace(/_medium\.jpg$/, "_full.jpg");

/* how many on a board are at or under an author time in seconds */
async function beatAuthor(board: string, author: number) {
  const scores = await getBoardScores(board);
  return scores.filter((s) => s <= author * SCORE_TICKS_PER_SECOND).length;
}

const wrLine = (score: number | undefined, who: string | undefined): Stat =>
  score === undefined
    ? { value: "—", label: "No times yet" }
    : { value: fmtTime(score), label: "World record · " + (who ?? ""), color: C.gold };

export async function cardFor(kind: Kind, id: string): Promise<CardData | null> {
  if (kind === "player") {
    const rec = await getPlayer(id);
    if (!rec) return null;
    const ws = rec.workshop;
    /* every Track and Map they have a time on, Circuit and Workshop counted together */
    const tracks = rec.seasons.flatMap((s) => s.tiers.flatMap((t) => t.tracks));
    const tracked = tracks.filter((t) => t.finish);
    const trackAuthors = tracked.filter(
      (t) =>
        (t.finish?.score ?? Infinity) <= (TRACKS[t.name]?.medals[3] ?? 0) * SCORE_TICKS_PER_SECOND,
    ).length;
    const authors = trackAuthors + ws.finishes.filter((f) => f.earned === "author").length;
    const wrs = tracked.filter((t) => t.finish?.rank === 1).length + ws.medals.wr;
    const finished = tracked.length + ws.finishes.length;
    const best = [
      ...tracked.map((t) => ({
        rank: t.finish?.rank ?? 0,
        field: t.field,
        board: t.name,
        preview: null as string | null,
      })),
      ...ws.finishes.map((f) => ({
        rank: f.rank,
        field: f.field,
        board: f.name,
        preview: f.preview,
      })),
    ].sort((a, b) => a.rank - b.rank || b.field - a.field)[0];
    const s2 = rec.seasons.find((s) => s.group === "Season 2");
    const [image, backdrop] = await Promise.all([
      remote(fullAvatar(rec.who.avatar)),
      best ? (best.preview ? remote(best.preview) : trackShot(best.board)) : null,
    ]);
    return {
      kind,
      kicker: "Player",
      title: personaOf(rec.who),
      image,
      backdrop,
      hue: hueFor(id),
      headline: s2?.overall
        ? { value: "#" + fmtN(s2.overall.rank), label: "Season 2 Overall", color: C.gold }
        : { value: fmtN(finished), label: "maps finished" },
      stats: [
        { value: fmtN(wrs), label: "World records", color: C.gold },
        { value: fmtN(authors), label: "Author medals", color: C.author },
        { value: fmtN(finished), label: "Maps finished" },
        ...(rec.made.length ? [{ value: fmtN(rec.made.length), label: "Maps made" }] : []),
      ],
    };
  }
  if (kind === "map") {
    const m = (await getWorkshop()).find((x) => x.pfid === id);
    if (!m) return null;
    const image = await remote(m.preview);
    return {
      kind,
      kicker: "Workshop map · by " + m.creator,
      title: m.title,
      image,
      backdrop: image,
      hue: hueFor(m.pfid),
      headline: wrLine(m.top3[0]?.[2], m.top3[0]?.[1]),
      stats: [
        { value: fmtN(m.entryCount), label: "Players" },
        { value: fmtSec(m.medals[3] ?? 0), label: "Author time", color: C.author },
        { value: fmtN(m.authorBeaten), label: "Beat the author", color: C.author },
        { value: fmtN(m.subs), label: "Subscribers" },
      ],
    };
  }
  if (kind === "daily") {
    const dates = await getDailyDates();
    const date = id === "latest" ? dates.at(-1) : id;
    const day = date ? await getDaily(date) : null;
    if (!day) return null;
    const [page, image, beat] = await Promise.all([
      getBoardPage(day.board, 0, 1),
      remote(day.preview),
      day.medals[3] ? beatAuthor(day.board, day.medals[3]) : Promise.resolve(0),
    ]);
    const wr = page.rows[0];
    const when = new Date(day.date + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const live = !day.final && Date.parse(day.endsAt) > Date.now();
    return {
      kind,
      kicker: "Daily · " + when,
      title: day.title,
      image,
      backdrop: image,
      hue: hueFor(day.pfid),
      headline: wr
        ? {
            value: fmtTime(wr.score),
            label: (live ? "Leading · " : "Winner · ") + personaOf(wr),
            color: C.gold,
          }
        : { value: "—", label: "No times yet" },
      stats: [
        { value: fmtN(page.total), label: "Players" },
        {
          value: day.medals[3] ? fmtSec(day.medals[3]) : "—",
          label: "Author time",
          color: C.author,
        },
        { value: fmtN(beat), label: "Beat the author", color: C.author },
        live
          ? { value: "Live", label: "Still open", color: C.live }
          : { value: "Final", label: "Closed" },
      ],
    };
  }
  const b = CIRCUIT.find((x) => x.name === id);
  const t = TRACKS[id];
  if (!b || !t) return null;
  const [page, image, beat] = await Promise.all([
    getBoardPage(id, 0, 1),
    trackShot(id),
    beatAuthor(id, t.medals[3]),
  ]);
  const wr = page.rows[0];
  return {
    kind,
    kicker: b.group + " · Circuit track",
    title: b.display,
    image,
    backdrop: image,
    hue: hueFor(id),
    headline: wrLine(wr?.score, wr ? personaOf(wr) : undefined),
    stats: [
      { value: fmtN(page.total), label: "Players" },
      { value: fmtSec(t.medals[3]), label: "Author time", color: C.author },
      { value: fmtN(beat), label: "Beat the author", color: C.author },
      { value: fmtSec(t.medals[2]), label: "Gold time", color: C.gold },
    ],
  };
}

/* ---------- drawing ---------- */

const W = 1200;
const H = 630;

function Marble({ hue, size }: { hue: number; size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size,
        display: "flex",
        backgroundImage: `radial-gradient(circle at 34% 28%, hsl(${hue} 90% 88%) 0%, hsl(${hue} 70% 58%) 22%, hsl(${hue} 65% 38%) 70%, hsl(${hue} 70% 22%) 100%)`,
      }}
    />
  );
}

function Brand({ size = 24 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Marble hue={95} size={size} />
      <div style={{ fontFamily: "Bungee", fontSize: size * 0.85, color: C.text, letterSpacing: 1 }}>
        ballestrecords.com
      </div>
    </div>
  );
}

function Picture({ d, w, h, radius }: { d: CardData; w: number; h: number; radius: number }) {
  if (d.image)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- satori draws plain img only
      <img src={d.image} width={w} height={h} style={{ borderRadius: radius, objectFit: "cover" }} />
    );
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `hsl(${d.hue} 45% 22%)`,
        color: `hsl(${d.hue} 80% 80%)`,
        fontFamily: "Bungee",
        fontSize: h * 0.45,
      }}
    >
      {d.title.slice(0, 1).toUpperCase()}
    </div>
  );
}

/* a full-size picture with a scrim over it, behind everything else */
function Bleed({ src, scrim }: { src: string | null; scrim: string }) {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex" }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- satori draws plain img only
        <img
          src={src}
          width={W}
          height={H}
          style={{ position: "absolute", left: 0, top: 0, objectFit: "cover" }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: H,
          display: "flex",
          backgroundImage: scrim,
        }}
      />
    </div>
  );
}

const frame = {
  width: W,
  height: H,
  display: "flex",
  position: "relative",
  fontFamily: "Chakra Petch",
  color: C.text,
  backgroundColor: C.bg,
  backgroundImage: `linear-gradient(135deg, #1a2a1c 0%, ${C.bg} 38%, ${C.bg} 62%, ${C.bg2} 100%)`,
} as const;

const fill = {
  position: "absolute",
  left: 0,
  top: 0,
  width: W,
  height: H,
  display: "flex",
} as const;

const titleSize = (t: string, big: number) =>
  t.length > 22 ? big * 0.62 : t.length > 14 ? big * 0.78 : big;

function Kicker({ d, size = 24 }: { d: CardData; size?: number }) {
  return (
    <div style={{ fontSize: size, color: C.dim, textTransform: "uppercase", letterSpacing: 3 }}>
      {d.kicker}
    </div>
  );
}

function Title({ d, size }: { d: CardData; size: number }) {
  return (
    <div style={{ fontFamily: "Bungee", fontSize: titleSize(d.title, size), lineHeight: 1.05 }}>
      {d.title}
    </div>
  );
}

function HeadlineLine({ d, size = 32 }: { d: CardData; size?: number }) {
  return (
    <div style={{ display: "flex", gap: 14, fontSize: size, fontWeight: 700, marginTop: 8 }}>
      <span style={{ color: d.headline.color ?? C.text }}>{d.headline.value}</span>
      <span style={{ color: C.dim, fontWeight: 600 }}>{d.headline.label}</span>
    </div>
  );
}

function Tile({ s, glass, big = 54 }: { s: Stat; glass?: boolean; big?: number }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "18px 22px",
        borderRadius: 18,
        backgroundColor: glass ? "rgba(10,16,32,0.72)" : "rgba(255,255,255,0.05)",
        border: `2px solid ${C.line}`,
      }}
    >
      <div
        style={{
          fontFamily: "Bungee",
          fontSize: s.value.length > 6 ? big * 0.7 : big,
          lineHeight: 1.4,
          color: s.color ?? C.text,
        }}
      >
        {s.value}
      </div>
      <div style={{ fontSize: 24, color: C.dim, fontWeight: 600 }}>{s.label}</div>
    </div>
  );
}

function Tiles({ d, glass, big }: { d: CardData; glass?: boolean; big?: number }) {
  return (
    <div style={{ display: "flex", gap: 18 }}>
      {d.stats.map((s) => (
        <Tile key={s.label} s={s} glass={glass} big={big} />
      ))}
    </div>
  );
}

/* tiles two to a row */
function Grid({ d, glass }: { d: CardData; glass?: boolean }) {
  const rows = [d.stats.slice(0, 2), d.stats.slice(2, 4)].filter((r) => r.length);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 16 }}>
          {r.map((s) => (
            <Tile key={s.label} s={s} glass={glass} big={50} />
          ))}
        </div>
      ))}
    </div>
  );
}

const SCRIM_LOW =
  "linear-gradient(180deg, rgba(10,16,32,0.1) 0%, rgba(10,16,32,0.3) 35%, rgba(10,16,32,0.9) 70%, rgba(10,16,32,0.97) 100%)";

/* ---- 1: round 1's two picks as they were, with the new stats ---- */

function Player1({ d }: { d: CardData }) {
  return (
    <div style={{ ...frame, flexDirection: "column", padding: 56 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <Picture d={d} w={168} h={168} radius={24} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <Kicker d={d} />
          <Title d={d} size={72} />
          <HeadlineLine d={d} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
        <Tiles d={d} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 26 }}>
        <Brand />
        <div style={{ fontSize: 22, color: C.faint }}>Ballest of Them All · unofficial</div>
      </div>
    </div>
  );
}

function Place1({ d }: { d: CardData }) {
  return (
    <div style={frame}>
      <Bleed src={d.backdrop} scrim={SCRIM_LOW} />
      <div style={{ ...fill, flexDirection: "column", padding: "40px 56px 44px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Pill>
            <Kicker d={d} size={22} />
          </Pill>
          <Pill>
            <Brand size={22} />
          </Pill>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <Title d={d} size={76} />
          <HeadlineLine d={d} />
          <div style={{ display: "flex", flexDirection: "column", marginTop: 22 }}>
            <Tiles d={d} glass big={44} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        padding: "8px 18px",
        borderRadius: 40,
        backgroundColor: "rgba(10,16,32,0.72)",
      }}
    >
      {children}
    </div>
  );
}

/* ---- 2: split down the middle, picture on the left ---- */

function Player2({ d }: { d: CardData }) {
  return (
    <div style={{ ...frame, padding: 48, gap: 44 }}>
      <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
        <Picture d={d} w={400} h={400} radius={28} />
        <div style={{ display: "flex", marginTop: "auto" }}>
          <Brand />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <Kicker d={d} />
        <Title d={d} size={64} />
        <HeadlineLine d={d} size={30} />
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <Grid d={d} />
        </div>
      </div>
    </div>
  );
}

function Place2({ d }: { d: CardData }) {
  return (
    <div style={frame}>
      <div style={{ display: "flex", width: 560, height: H, position: "relative" }}>
        {d.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- satori draws plain img only
          <img src={d.image} width={560} height={H} style={{ objectFit: "cover" }} />
        ) : (
          <Picture d={d} w={560} h={H} radius={0} />
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "44px 44px" }}>
        <Kicker d={d} size={22} />
        <Title d={d} size={56} />
        <HeadlineLine d={d} size={28} />
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <Grid d={d} />
        </div>
        <div style={{ display: "flex", marginTop: 22 }}>
          <Brand size={22} />
        </div>
      </div>
    </div>
  );
}

/* ---- 3: a picture band on top, a solid band of tiles below ---- */

function Banner({ d, pic, player }: { d: CardData; pic: string | null; player?: boolean }) {
  return (
    <div style={{ ...frame, flexDirection: "column" }}>
      <div style={{ display: "flex", width: W, height: 380, position: "relative" }}>
        {pic ? (
          // eslint-disable-next-line @next/next/no-img-element -- satori draws plain img only
          <img
            src={pic}
            width={W}
            height={380}
            style={{ position: "absolute", left: 0, top: 0, objectFit: "cover" }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: W,
            height: 380,
            display: "flex",
            backgroundImage: player
              ? "linear-gradient(180deg, rgba(10,16,32,0.55) 0%, rgba(10,16,32,0.75) 60%, rgba(10,16,32,1) 100%)"
              : "linear-gradient(180deg, rgba(10,16,32,0) 30%, rgba(10,16,32,0.85) 85%, rgba(10,16,32,1) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 56,
            right: 56,
            top: 36,
            bottom: 18,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Pill>
              <Brand size={22} />
            </Pill>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 28, marginTop: "auto" }}>
            {player ? <Picture d={d} w={150} h={150} radius={24} /> : null}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <Kicker d={d} size={22} />
              <Title d={d} size={70} />
              <HeadlineLine d={d} size={30} />
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "30px 56px 0" }}>
        <Tiles d={d} big={48} />
      </div>
    </div>
  );
}

const Player3 = ({ d }: { d: CardData }) => <Banner d={d} pic={d.backdrop} player />;
const Place3 = ({ d }: { d: CardData }) => <Banner d={d} pic={d.backdrop} />;

/* ---- 4: tiles stacked in a column on the right ---- */

function Column({ d, children }: { d: CardData; children: React.ReactNode }) {
  return (
    <div style={{ ...fill }}>
      <div
        style={{ display: "flex", flexDirection: "column", flex: 1, padding: "44px 40px 44px 56px" }}
      >
        {children}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 330,
          gap: 12,
          padding: "36px 40px 36px 0",
        }}
      >
        {d.stats.map((s) => (
          <Tile key={s.label} s={s} glass big={42} />
        ))}
      </div>
    </div>
  );
}

function Player4({ d }: { d: CardData }) {
  return (
    <div style={frame}>
      <Column d={d}>
        <Picture d={d} w={180} h={180} radius={180} />
        <div style={{ display: "flex", flexDirection: "column", marginTop: 28 }}>
          <Kicker d={d} />
          <Title d={d} size={72} />
          <HeadlineLine d={d} />
        </div>
        <div style={{ display: "flex", marginTop: "auto" }}>
          <Brand />
        </div>
      </Column>
    </div>
  );
}

function Place4({ d }: { d: CardData }) {
  return (
    <div style={frame}>
      <Bleed
        src={d.backdrop}
        scrim="linear-gradient(90deg, rgba(10,16,32,0.2) 0%, rgba(10,16,32,0.35) 45%, rgba(10,16,32,0.8) 100%), linear-gradient(180deg, rgba(10,16,32,0) 45%, rgba(10,16,32,0.9) 100%)"
      />
      <Column d={d}>
        <Pill>
          <Brand size={22} />
        </Pill>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <Kicker d={d} size={22} />
          <Title d={d} size={66} />
          <HeadlineLine d={d} size={30} />
        </div>
      </Column>
    </div>
  );
}

/* ---- 5: no boxes, the numbers set in one line under the title ---- */

function Inline({ d }: { d: CardData }) {
  return (
    <div style={{ display: "flex", gap: 44, marginTop: 26 }}>
      {d.stats.map((s) => (
        <div key={s.label} style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontFamily: "Bungee",
              fontSize: s.value.length > 6 ? 40 : 56,
              lineHeight: 1.3,
              color: s.color ?? C.text,
            }}
          >
            {s.value}
          </div>
          <div style={{ fontSize: 24, color: C.dim, fontWeight: 600 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function Player5({ d }: { d: CardData }) {
  return (
    <div style={{ ...frame, flexDirection: "column", padding: "52px 64px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Kicker d={d} />
        <Brand />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 30, marginTop: 30 }}>
        <Picture d={d} w={140} h={140} radius={140} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Title d={d} size={84} />
          <HeadlineLine d={d} />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          paddingTop: 10,
          borderTop: `2px solid ${C.line}`,
        }}
      >
        <Inline d={d} />
      </div>
    </div>
  );
}

function Place5({ d }: { d: CardData }) {
  return (
    <div style={frame}>
      <Bleed src={d.backdrop} scrim={SCRIM_LOW} />
      <div style={{ ...fill, flexDirection: "column", padding: "40px 64px 44px" }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Pill>
            <Brand size={22} />
          </Pill>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <Kicker d={d} size={22} />
          <Title d={d} size={80} />
          <HeadlineLine d={d} />
          <Inline d={d} />
        </div>
      </div>
    </div>
  );
}

type Draw = (p: { d: CardData }) => React.ReactElement;
const DRAW: Record<Variant, { player: Draw; place: Draw }> = {
  "1": { player: Player1, place: Place1 },
  "2": { player: Player2, place: Place2 },
  "3": { player: Player3, place: Place3 },
  "4": { player: Player4, place: Place4 },
  "5": { player: Player5, place: Place5 },
};

let fonts: Promise<ConstructorParameters<typeof ImageResponse>[1]> | undefined;
function loadFonts() {
  fonts ??= Promise.all([
    readFile(join(ASSETS, "Bungee-Regular.ttf")),
    readFile(join(ASSETS, "ChakraPetch-Medium.ttf")),
    readFile(join(ASSETS, "ChakraPetch-SemiBold.ttf")),
    readFile(join(ASSETS, "ChakraPetch-Bold.ttf")),
  ]).then(([bungee, m, sb, b]) => ({
    fonts: [
      { name: "Bungee", data: bungee, weight: 400 as const, style: "normal" as const },
      { name: "Chakra Petch", data: m, weight: 500 as const, style: "normal" as const },
      { name: "Chakra Petch", data: sb, weight: 600 as const, style: "normal" as const },
      { name: "Chakra Petch", data: b, weight: 700 as const, style: "normal" as const },
    ],
  }));
  return fonts;
}

export async function drawCard(variant: Variant, d: CardData) {
  const set = DRAW[variant];
  const Draw = d.kind === "player" ? set.player : set.place;
  return new ImageResponse(<Draw d={d} />, {
    width: W,
    height: H,
    ...(await loadFonts()),
    headers: { "cache-control": "public, max-age=300" },
  });
}
