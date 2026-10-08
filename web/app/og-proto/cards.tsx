// PROTOTYPE (grill-design, share images). Never merged: the winner is rebuilt by
// /implement-spec. Every page kind is first boiled down to one CardData, then each variant
// draws that the same way, so a variant is judged across players, Maps and Tracks at once.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { getBoardPage, getPlayer, getWorkshop } from "../../db/data";
import { CIRCUIT, TRACKS } from "../../lib/circuit";
import { fmtN, fmtSec, fmtTime, hueFor, ord, personaOf, safeImg } from "../../lib/rules";

export const VARIANTS = {
  A: "Headline",
  B: "Stat sheet",
  C: "Podium",
  D: "Poster",
  E: "Board excerpt",
} as const;
export type Variant = keyof typeof VARIANTS;
export const KINDS = ["player", "map", "track"] as const;
export type Kind = (typeof KINDS)[number];

const C = {
  bg: "#0a1020",
  bg2: "#16244a",
  solid: "#111a2c",
  text: "#eaf0ff",
  dim: "#93a2c8",
  faint: "#63719a",
  accent: "#8be03c",
  ink: "#0d2000",
  gold: "#ffd447",
  silver: "#d3dcea",
  bronze: "#ef9a52",
  author: "#5fd4ff",
  line: "rgba(150,175,245,0.18)",
};
const PLACE = [C.gold, C.silver, C.bronze];

interface Stat {
  value: string;
  label: string;
  color?: string;
}
interface Row {
  rank: number;
  name: string;
  value: string;
  sub?: string;
}
export interface CardData {
  kind: Kind;
  kicker: string;
  title: string;
  /* avatar, Map preview or Track screenshot (data: URL), or null */
  image: string | null;
  /* the picture a full-bleed card sits on */
  backdrop: string | null;
  hue: number;
  headline: Stat;
  stats: Array<Stat>;
  rows: Array<Row>;
  /* rows' heading, e.g. "Top of the board" or "Best finishes" */
  rowsLabel: string;
  podium: Array<{ name: string; value: string; hue: number }>;
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

async function boardRows(name: string, n: number): Promise<Array<Row>> {
  const page = await getBoardPage(name, 0, n);
  return page.rows.map((r) => ({
    rank: r.rank,
    name: personaOf(r),
    value: fmtTime(r.score),
  }));
}

export async function cardFor(kind: Kind, id: string): Promise<CardData | null> {
  if (kind === "player") {
    const rec = await getPlayer(id);
    if (!rec) return null;
    const name = personaOf(rec.who);
    const s2 = rec.seasons.find((s) => s.group === "Season 2");
    const ws = rec.workshop;
    const circuitPods = rec.medals.gold + rec.medals.silver + rec.medals.bronze;
    const best = [
      ...rec.seasons.flatMap((s) =>
        s.tiers.flatMap((t) =>
          t.tracks
            .filter((x) => x.finish)
            .map((x) => ({
              rank: x.finish?.rank ?? 0,
              field: x.field,
              name: (s.group === "Season 2" ? "S2 " : "S1 ") + x.display,
              value: fmtTime(x.finish?.score ?? 0),
              board: x.name,
              preview: null as string | null,
            })),
        ),
      ),
      ...ws.finishes.map((f) => ({
        rank: f.rank,
        field: f.field,
        name: f.display,
        value: fmtTime(f.score),
        board: f.name,
        preview: f.preview,
      })),
    ].sort((a, b) => a.rank - b.rank || b.field - a.field);
    const top = best[0];
    const placed = (r: number) => ws.finishes.filter((f) => f.rank === r).length;
    const headline: Stat = s2?.overall
      ? { value: "#" + fmtN(s2.overall.rank), label: "Season 2 Overall", color: C.gold }
      : ws.medals.wr
        ? { value: fmtN(ws.medals.wr), label: "Workshop world records", color: C.gold }
        : { value: fmtN(ws.finishes.length), label: "Workshop maps finished" };
    const [image, backdrop] = await Promise.all([
      remote(fullAvatar(rec.who.avatar)),
      top ? (top.preview ? remote(top.preview) : trackShot(top.board)) : null,
    ]);
    return {
      kind,
      kicker: "Player",
      title: name,
      image,
      backdrop,
      hue: hueFor(id),
      headline,
      stats: [
        { value: fmtN(rec.medals.gold + ws.medals.wr), label: "World records", color: C.gold },
        { value: fmtN(circuitPods + ws.podiums), label: "Podiums", color: C.silver },
        { value: fmtN(ws.finishes.length), label: "Maps finished" },
        rec.made.length
          ? { value: fmtN(rec.made.length), label: "Maps made", color: C.author }
          : { value: fmtN(rec.run), label: "Tracks raced" },
      ],
      rows: best.slice(0, 5).map((b) => ({
        rank: b.rank,
        name: b.name,
        value: b.value,
        sub: "of " + fmtN(b.field),
      })),
      rowsLabel: "Best finishes",
      podium: [
        { name: fmtN(rec.medals.silver + placed(2)), value: "2nd places", hue: 220 },
        { name: fmtN(rec.medals.gold + placed(1)), value: "1st places", hue: 95 },
        { name: fmtN(rec.medals.bronze + placed(3)), value: "3rd places", hue: 330 },
      ],
    };
  }
  if (kind === "map") {
    const m = (await getWorkshop()).find((x) => x.pfid === id);
    if (!m) return null;
    const [rows, image] = await Promise.all([boardRows(m.name, 5), remote(m.preview)]);
    const wr = m.top3[0];
    return {
      kind,
      kicker: "Workshop map · by " + m.creator,
      title: m.title,
      image,
      backdrop: image,
      hue: hueFor(m.pfid),
      headline: wr
        ? { value: fmtTime(wr[2]), label: "World record · " + wr[1], color: C.gold }
        : { value: "—", label: "No times yet" },
      stats: [
        { value: fmtN(m.entryCount), label: "Players" },
        { value: fmtSec(m.medals[3] ?? 0), label: "Author time", color: C.author },
        { value: fmtN(m.authorBeaten), label: "Beat the author", color: C.author },
        { value: fmtN(m.subs), label: "Subscribers" },
      ],
      rows,
      rowsLabel: "Top of the board",
      podium: m.top3.map(([sid, who, score]) => ({
        name: who,
        value: fmtTime(score),
        hue: hueFor(sid),
      })),
    };
  }
  const b = CIRCUIT.find((x) => x.name === id);
  const t = TRACKS[id];
  if (!b || !t) return null;
  const [page, image] = await Promise.all([getBoardPage(id, 0, 5), trackShot(id)]);
  const rows = page.rows.map((r) => ({ rank: r.rank, name: personaOf(r), value: fmtTime(r.score) }));
  const wr = page.rows[0];
  return {
    kind,
    kicker: b.group + " · Circuit track",
    title: b.display,
    image,
    backdrop: image,
    hue: hueFor(id),
    headline: wr
      ? { value: fmtTime(wr.score), label: "World record · " + personaOf(wr), color: C.gold }
      : { value: "—", label: "No times yet" },
    stats: [
      { value: fmtN(page.total), label: "Players" },
      { value: fmtSec(t.medals[3]), label: "Author time", color: C.author },
      { value: fmtSec(t.medals[2]), label: "Gold time", color: C.gold },
      { value: wr ? fmtTime(page.rows.at(-1)?.score ?? 0) : "—", label: "5th place" },
    ],
    rows,
    rowsLabel: "Top of the board",
    podium: page.rows.slice(0, 3).map((r) => ({
      name: personaOf(r),
      value: fmtTime(r.score),
      hue: hueFor(r.steamId),
    })),
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
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
      }}
    />
  );
}

function Brand({ size = 26 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Marble hue={95} size={size} />
      <div style={{ fontFamily: "Bungee", fontSize: size * 0.85, color: C.text, letterSpacing: 1 }}>
        ballestrecords.com
      </div>
    </div>
  );
}

function Picture({
  d,
  size,
  radius,
}: {
  d: CardData;
  size: number | { w: number; h: number };
  radius: number;
}) {
  const w = typeof size === "number" ? size : size.w;
  const h = typeof size === "number" ? size : size.h;
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

const frame = {
  width: W,
  height: H,
  display: "flex",
  fontFamily: "Chakra Petch",
  color: C.text,
  backgroundColor: C.bg,
  backgroundImage: `linear-gradient(135deg, #1a2a1c 0%, ${C.bg} 38%, ${C.bg} 62%, ${C.bg2} 100%)`,
} as const;

const titleSize = (t: string, big: number) =>
  t.length > 22 ? big * 0.62 : t.length > 14 ? big * 0.78 : big;

/* A: one big name, one number */
function Headline({ d }: { d: CardData }) {
  return (
    <div style={{ ...frame, flexDirection: "column", padding: "64px 80px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {d.kind === "player" ? <Picture d={d} size={72} radius={72} /> : null}
        <div style={{ fontSize: 30, color: C.dim, textTransform: "uppercase", letterSpacing: 3 }}>
          {d.kicker}
        </div>
      </div>
      <div
        style={{
          fontFamily: "Bungee",
          fontSize: titleSize(d.title, 96),
          lineHeight: 1.05,
          marginTop: 22,
          maxWidth: 1040,
        }}
      >
        {d.title}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 22, marginTop: "auto" }}>
        <div style={{ fontFamily: "Bungee", fontSize: 120, color: d.headline.color ?? C.text }}>
          {d.headline.value}
        </div>
        <div style={{ fontSize: 38, color: C.dim, fontWeight: 600 }}>{d.headline.label}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <Brand />
      </div>
    </div>
  );
}

/* B: identity strip, then four tiles */
function StatSheet({ d }: { d: CardData }) {
  return (
    <div style={{ ...frame, flexDirection: "column", padding: 56 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <Picture
          d={d}
          size={d.kind === "player" ? 168 : { w: 300, h: 168 }}
          radius={d.kind === "player" ? 24 : 16}
        />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 26, color: C.dim, textTransform: "uppercase", letterSpacing: 3 }}>
            {d.kicker}
          </div>
          <div style={{ fontFamily: "Bungee", fontSize: titleSize(d.title, 72), lineHeight: 1.05 }}>
            {d.title}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 32, fontWeight: 700 }}>
            <span style={{ color: d.headline.color ?? C.text }}>{d.headline.value}</span>
            <span style={{ color: C.dim, fontWeight: 500 }}>{d.headline.label}</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: "auto" }}>
        {d.stats.map((s) => (
          <div
            key={s.label}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "22px 24px",
              borderRadius: 18,
              backgroundColor: "rgba(255,255,255,0.05)",
              border: `2px solid ${C.line}`,
            }}
          >
            <div
              style={{
                fontFamily: "Bungee",
                fontSize: s.value.length > 6 ? 38 : 54,
                lineHeight: 1.4,
                color: s.color ?? C.text,
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 24, color: C.dim, fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 26 }}>
        <Brand size={24} />
        <div style={{ fontSize: 22, color: C.faint }}>Ballest of Them All · unofficial</div>
      </div>
    </div>
  );
}

/* C: the site's podium picture, filled in */
function Podium({ d }: { d: CardData }) {
  const order = d.kind === "player" ? d.podium : [d.podium[1], d.podium[0], d.podium[2]];
  const heights = [200, 270, 150];
  const colors = [C.silver, C.gold, C.bronze];
  const labels = ["2", "1", "3"];
  return (
    <div style={{ ...frame, padding: "0 0 0 72px" }}>
      <div style={{ display: "flex", flexDirection: "column", width: 520, paddingTop: 70 }}>
        <div style={{ fontSize: 26, color: C.dim, textTransform: "uppercase", letterSpacing: 3 }}>
          {d.kicker}
        </div>
        <div
          style={{
            fontFamily: "Bungee",
            fontSize: titleSize(d.title, 76),
            lineHeight: 1.05,
            marginTop: 8,
          }}
        >
          {d.title}
        </div>
        <div style={{ fontSize: 34, color: C.dim, marginTop: 18, fontWeight: 600 }}>
          {d.headline.label}
        </div>
        <div style={{ fontFamily: "Bungee", fontSize: 64, color: d.headline.color ?? C.text }}>
          {d.headline.value}
        </div>
        <div style={{ display: "flex", marginTop: "auto", marginBottom: 56 }}>
          <Brand size={24} />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
          marginLeft: "auto",
          marginRight: 56,
        }}
      >
        {[0, 1, 2].map((i) => {
          const p = order[i];
          return (
            <div
              key={i}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 180 }}
            >
              {d.kind === "player" && i === 1 && d.image ? (
                <Picture d={d} size={120} radius={120} />
              ) : (
                <Marble hue={p?.hue ?? 230} size={110} />
              )}
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  marginTop: 10,
                  maxWidth: 176,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {p ? (d.kind === "player" ? p.value : p.name) : "—"}
              </div>
              <div
                style={{
                  marginTop: 10,
                  width: 180,
                  height: heights[i],
                  borderRadius: "10px 10px 0 0",
                  backgroundColor: colors[i],
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 18,
                  color: "rgba(10,16,32,0.6)",
                }}
              >
                <div style={{ fontFamily: "Bungee", fontSize: d.kind === "player" ? 56 : 48 }}>
                  {d.kind === "player" ? (p?.name ?? "0") : labels[i]}
                </div>
                {d.kind !== "player" && p ? (
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{p.value}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* D: the picture is the card */
function Poster({ d }: { d: CardData }) {
  const bg = d.backdrop ?? d.image;
  return (
    <div style={{ ...frame, position: "relative" }}>
      {bg ? (
        // eslint-disable-next-line @next/next/no-img-element -- satori draws plain img only
        <img
          src={bg}
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
          backgroundImage:
            "linear-gradient(180deg, rgba(10,16,32,0.15) 0%, rgba(10,16,32,0.35) 40%, rgba(10,16,32,0.92) 78%, rgba(10,16,32,0.98) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          padding: "44px 64px 48px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              padding: "8px 18px",
              borderRadius: 40,
              backgroundColor: "rgba(10,16,32,0.7)",
              fontSize: 24,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: C.text,
            }}
          >
            {d.kicker}
          </div>
          <div
            style={{
              display: "flex",
              padding: "8px 18px",
              borderRadius: 40,
              backgroundColor: "rgba(10,16,32,0.7)",
            }}
          >
            <Brand size={22} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 28, marginTop: "auto" }}>
          {d.kind === "player" ? <Picture d={d} size={150} radius={24} /> : null}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{ fontFamily: "Bungee", fontSize: titleSize(d.title, 84), lineHeight: 1.02 }}
            >
              {d.title}
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 36, fontWeight: 700, marginTop: 8 }}>
              <span style={{ color: d.headline.color ?? C.text }}>{d.headline.value}</span>
              <span style={{ color: C.dim, fontWeight: 600 }}>{d.headline.label}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* E: a slice of the board itself */
function Excerpt({ d }: { d: CardData }) {
  return (
    <div style={{ ...frame, padding: 52, gap: 44 }}>
      <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
        <Picture
          d={d}
          size={d.kind === "player" ? 160 : { w: 400, h: 225 }}
          radius={d.kind === "player" ? 160 : 16}
        />
        <div
          style={{
            fontSize: 22,
            color: C.dim,
            textTransform: "uppercase",
            letterSpacing: 2,
            marginTop: 24,
          }}
        >
          {d.kicker}
        </div>
        <div style={{ fontFamily: "Bungee", fontSize: titleSize(d.title, 54), lineHeight: 1.05 }}>
          {d.title}
        </div>
        <div style={{ display: "flex", marginTop: "auto" }}>
          <Brand size={22} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div
          style={{
            fontSize: 22,
            color: C.faint,
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 12,
            lineHeight: 1.3,
          }}
        >
          {d.rowsLabel}
        </div>
        {d.rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              height: 92,
              padding: "0 22px",
              marginBottom: 10,
              borderRadius: 14,
              backgroundColor: i % 2 ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.07)",
              borderLeft: `6px solid ${PLACE[r.rank - 1] ?? C.line}`,
            }}
          >
            <div
              style={{
                fontFamily: "Bungee",
                fontSize: 34,
                width: 100,
                color: PLACE[r.rank - 1] ?? C.dim,
              }}
            >
              {r.rank <= 999 ? ord(r.rank) : fmtN(r.rank)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 380,
                }}
              >
                {r.name}
              </div>
              {r.sub ? <div style={{ fontSize: 20, color: C.faint }}>{r.sub}</div> : null}
            </div>
            <div style={{ fontSize: 34, fontWeight: 700, color: C.text }}>{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const DRAW: Record<Variant, (p: { d: CardData }) => React.ReactElement> = {
  A: Headline,
  B: StatSheet,
  C: Podium,
  D: Poster,
  E: Excerpt,
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
  const Draw = DRAW[variant];
  return new ImageResponse(<Draw d={d} />, {
    width: W,
    height: H,
    ...(await loadFonts()),
    headers: { "cache-control": "public, max-age=300" },
  });
}
