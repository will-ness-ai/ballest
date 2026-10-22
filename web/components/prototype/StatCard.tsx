// PROTOTYPE (grill-design, never merged): five stat card images for the Discord stat card
// channel. Drawn through next/og like components/share/Card.tsx, from the production site's
// own APIs so the cards show real players locally and on the preview alike.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import type { PlayerRecord } from "../../lib/player";
import { fmtN, hueFor, personaOf } from "../../lib/rules";

const ASSETS = join(process.cwd(), "assets", "share");
const PROD = "https://ballestrecords.com";

const C = {
  bg: "#0a1020",
  bg2: "#16244a",
  text: "#eaf0ff",
  dim: "#93a2c8",
  gold: "#ffd447",
  author: "#5fd4ff",
  accent: "#b8f04a",
  line: "rgba(150,175,245,0.18)",
  tile: "rgba(255,255,255,0.05)",
};

type Place = { place: number; shared: boolean; n: number; total: number } | null;
export interface Stat {
  id: string;
  name: string;
  face: string | null;
  hue: number;
  wr: number;
  author: number;
  gold: number;
  silver: number;
  bronze: number;
  plain: number;
  /* each finish once, under the best it holds: a world record, else its Medal */
  best: Record<"wr" | "author" | "gold" | "silver" | "bronze" | "none", number>;
  finished: number;
  onWorkshop: number;
  tracks: number;
  tracksRun: number;
  podiums: number;
  made: number;
  s2: { rank: number } | null;
  places: Record<"played" | "author" | "wr" | "top5", Place>;
}

async function dataUrl(u: string | null | undefined) {
  if (!u) return null;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const type = r.headers.get("content-type") ?? "image/jpeg";
    return `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

/* every count adds the Circuit's Tracks and the Workshop's Maps, as the share card does */
export async function statOf(id: string): Promise<Stat | null> {
  const r = await fetch(`${PROD}/api/player/${id}`);
  if (!r.ok) return null;
  const rec = (await r.json()) as PlayerRecord;
  const lad = (await (await fetch(`${PROD}/api/standings?ladders&player=${id}`)).json()) as {
    lists: Record<
      string,
      { total: number; you: { n: number; place: number; shared: boolean } | null }
    >;
  };
  const run = rec.seasons.flatMap((s) => s.tiers.flatMap((t) => t.tracks));
  const t = (k: string) => run.filter((x) => x.finish?.earned === k).length;
  const ws = rec.workshop;
  const place = (k: string): Place => {
    const l = lad.lists[k];
    return l?.you ? { ...l.you, total: l.total } : null;
  };
  return {
    id,
    name: personaOf(rec.who),
    face: await dataUrl(rec.who.avatar?.replace(/_medium\.jpg$/, "_full.jpg")),
    hue: hueFor(id),
    wr: rec.medals.gold + ws.medals.wr,
    author: t("author") + ws.finishes.filter((f) => f.earned === "author").length,
    gold: t("gold") + ws.medals.gold,
    silver: t("silver") + ws.medals.silver,
    bronze: t("bronze") + ws.medals.bronze,
    plain: t("none") + ws.medals.none,
    best: (() => {
      const b = { wr: 0, author: 0, gold: 0, silver: 0, bronze: 0, none: 0 };
      for (const x of run) if (x.finish) b[x.finish.rank === 1 ? "wr" : x.finish.earned]++;
      for (const f of ws.finishes) b[f.rank === 1 ? "wr" : f.earned]++;
      return b;
    })(),
    finished: rec.run + ws.finishes.length,
    onWorkshop: ws.mapsOnWorkshop,
    tracks: rec.tracks,
    tracksRun: rec.run,
    podiums: ws.podiums + rec.medals.gold + rec.medals.silver + rec.medals.bronze,
    made: rec.made.length,
    s2: rec.seasons.find((s) => s.group === "Season 2")?.overall ?? null,
    places: {
      played: place("played"),
      author: place("author"),
      wr: place("wr"),
      top5: place("top5"),
    },
  };
}

/* ---------- pictures ---------- */

const uri = (svg: string) => "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");

function ballSrc(h: number) {
  const s = String(h);
  return uri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><radialGradient id="g" cx="34%" cy="27%" r="80%"><stop offset="0%" stop-color="hsl(${s},94%,90%)"/><stop offset="34%" stop-color="hsl(${s},80%,64%)"/><stop offset="100%" stop-color="hsl(${s},62%,25%)"/></radialGradient><clipPath id="c"><circle cx="20" cy="20" r="19"/></clipPath></defs><circle cx="20" cy="20" r="19" fill="url(#g)"/><g clip-path="url(#c)"><path d="M-4 27C6 34 18 33 26 26s10-16 8-24" fill="none" stroke="hsl(${s},66%,20%)" stroke-opacity=".26" stroke-width="4.5"/></g><ellipse cx="13" cy="11.5" rx="5.4" ry="3.4" fill="#fff" fill-opacity=".62" transform="rotate(-28 13 11.5)"/><circle cx="20" cy="20" r="19" fill="none" stroke="hsl(${s},60%,16%)" stroke-opacity=".35"/></svg>`,
  );
}
const Ball = ({ hue, size }: { hue: number; size: number }) => (
  <img src={ballSrc(hue)} width={size} height={size} alt="" />
);

type MedalKind = "wr" | "author" | "gold" | "silver" | "bronze";
const STOPS: Record<Exclude<MedalKind, "wr">, [string, string, string]> = {
  bronze: ["#9c6c1f", "#e0a650", "#f9cb85"],
  silver: ["#7a7a7a", "#c9c9c9", "#ffffff"],
  gold: ["#e0b800", "#ffe600", "#fff7b0"],
  author: ["#b86ae6", "#8fa2f0", "#5ef0f5"],
};
export const MEDAL_COLOUR: Record<MedalKind, string> = {
  wr: C.accent,
  author: "#8fa2f0",
  gold: "#ffe600",
  silver: "#c9c9c9",
  bronze: "#e0a650",
};
function medalSrc(k: MedalKind) {
  if (k === "wr")
    return uri(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 26"><path d="M4 0h5l3 9H7z" fill="#1c2a4a"/><path d="M11 0h5l-3 9H8z" fill="#2d4476"/><circle cx="10" cy="16.5" r="8.4" fill="${C.accent}" stroke="#ffd447" stroke-width="1.6"/><text x="10" y="20.6" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="11" fill="#14200a">1</text></svg>`,
    );
  const [dark, mid, light] = STOPS[k];
  return uri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 26"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><path d="M4 0h5l3 9H7z" fill="#1c2a4a"/><path d="M11 0h5l-3 9H8z" fill="#2d4476"/><circle cx="10" cy="16.5" r="8.4" fill="url(#m)" stroke="#111" stroke-width="1.4"/><circle cx="10" cy="16.5" r="5.4" fill="none" stroke="#111" stroke-opacity=".28" stroke-width="1.2"/></svg>`,
  );
}
const Medal = ({ k, size }: { k: MedalKind; size: number }) => (
  <img src={medalSrc(k)} width={size} height={Math.round(size * 1.3)} alt="" />
);

function Face({ s, size, ring = 8 }: { s: Stat; size: number; ring?: number }) {
  if (!s.face) return <Ball hue={s.hue} size={size} />;
  return (
    <img
      src={s.face}
      width={size}
      height={size}
      alt=""
      style={{
        borderRadius: size,
        objectFit: "cover",
        border: `${String(ring)}px solid hsl(${String(s.hue)} 78% 58%)`,
      }}
    />
  );
}

function Brand({ size = 22 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Ball hue={96} size={size} />
      <div style={{ fontFamily: "Bungee", fontSize: size * 0.85, color: C.dim, letterSpacing: 1 }}>
        ballestrecords.com
      </div>
    </div>
  );
}

const nameSize = (t: string, big: number) =>
  t.length > 18 ? big * 0.6 : t.length > 12 ? big * 0.78 : big;
const ord = (p: Place) => (p ? `${p.shared ? "=" : "#"}${fmtN(p.place)}` : "—");

const frame = (w: number, h: number) =>
  ({
    width: w,
    height: h,
    display: "flex",
    position: "relative",
    fontFamily: "Chakra Petch",
    color: C.text,
    backgroundColor: C.bg,
    backgroundImage: `linear-gradient(135deg, #1a2a1c 0%, ${C.bg} 38%, ${C.bg} 62%, ${C.bg2} 100%)`,
  }) as const;

const MEDALS: Array<[MedalKind, string, (s: Stat) => number]> = [
  ["wr", "World records", (s) => s.wr],
  ["author", "Author", (s) => s.author],
  ["gold", "Gold", (s) => s.gold],
  ["silver", "Silver", (s) => s.silver],
  ["bronze", "Bronze", (s) => s.bronze],
];

/* ---------- A · Share card, more tiles ---------- */
/* the player share card as it is (Split), its four tiles grown to six with Gold and
   Podiums; the closest thing to what the site already draws */
function A({ s }: { s: Stat }) {
  const tiles: Array<[string, string, string]> = [
    [fmtN(s.wr), "World records", C.gold],
    [fmtN(s.author), "Author medals", C.author],
    [fmtN(s.gold), "Gold medals", "#ffe600"],
    [fmtN(s.podiums), "Podiums", C.text],
    [fmtN(s.finished), "Maps finished", C.text],
    [fmtN(s.made), "Maps made", C.text],
  ];
  return (
    <div style={{ ...frame(1200, 630), padding: 44, gap: 40 }}>
      <div style={{ display: "flex", flexDirection: "column", width: 330 }}>
        <Face s={s} size={330} ring={10} />
        <div style={{ display: "flex", marginTop: "auto" }}>
          <Brand />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ fontSize: 24, color: C.dim, letterSpacing: 3 }}>PLAYER</div>
        <div style={{ fontFamily: "Bungee", fontSize: nameSize(s.name, 64), lineHeight: 1.05 }}>
          {s.name}
        </div>
        {s.s2 ? (
          <div style={{ display: "flex", gap: 14, fontSize: 30, fontWeight: 700, marginTop: 6 }}>
            <span style={{ color: C.gold }}>{`#${fmtN(s.s2.rank)}`}</span>
            <span style={{ color: C.dim }}>Season 2 Overall</span>
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: "auto" }}>
          {tiles.map(([v, l, c]) => (
            <div
              key={l}
              style={{
                width: 242,
                display: "flex",
                flexDirection: "column",
                padding: "12px 18px",
                borderRadius: 16,
                backgroundColor: C.tile,
                border: `2px solid ${C.line}`,
              }}
            >
              <div style={{ fontFamily: "Bungee", fontSize: 44, color: c, lineHeight: 1.3 }}>
                {v}
              </div>
              <div style={{ fontSize: 22, color: C.dim, fontWeight: 600 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- B · Medal cabinet ---------- */
/* a shelf of five big Medals with the count under each, the player across the top and one
   line of totals underneath; built to read at Discord's ~500 px */
function B({ s }: { s: Stat }) {
  return (
    <div style={{ ...frame(1200, 675), flexDirection: "column", padding: "40px 56px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <Face s={s} size={120} ring={6} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontFamily: "Bungee", fontSize: nameSize(s.name, 64), lineHeight: 1.05 }}>
            {s.name}
          </div>
          <div style={{ fontSize: 28, color: C.dim, fontWeight: 600 }}>
            {`${fmtN(s.finished)} Maps finished${s.s2 ? ` · #${fmtN(s.s2.rank)} Season 2` : ""}`}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 36,
          padding: "30px 30px 22px",
          borderRadius: 24,
          backgroundColor: "rgba(0,0,0,0.28)",
          border: `2px solid ${C.line}`,
        }}
      >
        {MEDALS.map(([k, label, n]) => (
          <div
            key={k}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: 190,
              opacity: n(s) ? 1 : 0.35,
            }}
          >
            <Medal k={k} size={96} />
            <div style={{ fontFamily: "Bungee", fontSize: 64, color: MEDAL_COLOUR[k] }}>
              {fmtN(n(s))}
            </div>
            <div style={{ fontSize: 26, color: C.dim, fontWeight: 600 }}>
              {k === "wr" ? "WRs" : label}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto", justifyContent: "flex-end" }}>
        <Brand />
      </div>
    </div>
  );
}

/* ---------- C · Ball card ---------- */
/* a portrait trading card: the marble big in a frame tinted by the player's hue, the
   name on a plate, and the stats as rows down the card, best first */
function C3({ s }: { s: Stat }) {
  const hue = String(s.hue);
  const rows: Array<[MedalKind | null, string, number]> = [
    ["wr", "World records", s.wr],
    ["author", "Author medals", s.author],
    ["gold", "Gold medals", s.gold],
    [null, "Maps finished", s.finished],
    [null, "Maps made", s.made],
  ];
  return (
    <div
      style={{
        ...frame(720, 1000),
        padding: 22,
        backgroundImage: `linear-gradient(160deg, hsl(${hue} 70% 55%), hsl(${hue} 60% 22%))`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          borderRadius: 28,
          backgroundColor: C.bg,
          padding: 30,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand size={20} />
          {s.s2 ? (
            <div style={{ fontFamily: "Bungee", fontSize: 30, color: C.gold }}>
              {`#${fmtN(s.s2.rank)}`}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
          <Face s={s} size={330} ring={12} />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 20,
            padding: "10px 0",
            borderRadius: 14,
            backgroundColor: `hsl(${hue} 60% 30%)`,
            fontFamily: "Bungee",
            fontSize: nameSize(s.name, 52),
          }}
        >
          {s.name}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 22 }}>
          {rows.map(([k, l, n]) => (
            <div
              key={l}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "6px 14px",
                borderBottom: `2px solid ${C.line}`,
              }}
            >
              <div style={{ display: "flex", width: 40, justifyContent: "center" }}>
                {k ? <Medal k={k} size={30} /> : <Ball hue={s.hue} size={30} />}
              </div>
              <div style={{ fontSize: 32, color: C.dim, fontWeight: 600, flex: 1 }}>{l}</div>
              <div
                style={{
                  fontFamily: "Bungee",
                  fontSize: 40,
                  color: k ? MEDAL_COLOUR[k] : C.text,
                }}
              >
                {fmtN(n)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- D · Your places ---------- */
/* places, not counts: where the player stands on the Daily Report's four lists (the /you
   page's ladders), the count small under each place */
function D({ s }: { s: Stat }) {
  const lists: Array<[keyof Stat["places"], string, string]> = [
    ["wr", "World records", C.gold],
    ["author", "Author medals", C.author],
    ["top5", "Top 5s", C.accent],
    ["played", "Maps played", C.text],
  ];
  return (
    <div style={{ ...frame(1200, 630), flexDirection: "column", padding: "40px 52px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <Face s={s} size={92} ring={5} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 24, color: C.dim, letterSpacing: 3 }}>WHERE THEY STAND</div>
          <div style={{ fontFamily: "Bungee", fontSize: nameSize(s.name, 56), lineHeight: 1.05 }}>
            {s.name}
          </div>
        </div>
        <Brand />
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: "auto" }}>
        {lists.map(([k, label, c]) => {
          const p = s.places[k];
          return (
            <div
              key={k}
              style={{
                flex: 1,
                height: 380,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "26px 24px",
                borderRadius: 22,
                backgroundColor: C.tile,
                border: `2px solid ${C.line}`,
              }}
            >
              <div style={{ fontSize: 28, color: C.dim, fontWeight: 700 }}>{label}</div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    fontFamily: "Bungee",
                    fontSize: ord(p).length > 5 ? 64 : 84,
                    color: c,
                    lineHeight: 1.1,
                  }}
                >
                  {ord(p)}
                </div>
                <div style={{ fontSize: 28, color: C.text, fontWeight: 600 }}>
                  {p ? `${fmtN(p.n)} · of ${fmtN(p.total)}` : "None yet"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- E · Collection bar ---------- */
/* the Workshop as a collection: one long bar of every Map, coloured by the Medal the
   player holds on it (WR, Author, Gold, Silver, Bronze, finished, not yet), the legend
   counting each; the Circuit's Tracks as a second, short bar */
function E({ s }: { s: Stat }) {
  const segs: Array<[string, number, string]> = [
    ["WR", s.best.wr, C.accent],
    ["Author", s.best.author, "#8fa2f0"],
    ["Gold", s.best.gold, "#ffe600"],
    ["Silver", s.best.silver, "#c9c9c9"],
    ["Bronze", s.best.bronze, "#e0a650"],
    ["No medal", s.best.none, "#4a5a80"],
  ];
  const total = s.onWorkshop + s.tracks;
  const W = 1096;
  const done = s.finished;
  return (
    <div style={{ ...frame(1200, 630), flexDirection: "column", padding: "44px 52px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Face s={s} size={100} ring={5} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontFamily: "Bungee", fontSize: nameSize(s.name, 60), lineHeight: 1.05 }}>
            {s.name}
          </div>
          <div style={{ fontSize: 28, color: C.dim, fontWeight: 600 }}>
            {s.s2 ? `#${fmtN(s.s2.rank)} Season 2 Overall` : "Workshop player"}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 40 }}>
        <div style={{ fontFamily: "Bungee", fontSize: 92, color: C.accent, lineHeight: 1 }}>
          {fmtN(done)}
        </div>
        <div style={{ fontSize: 34, color: C.dim, fontWeight: 600 }}>
          {`of ${fmtN(total)} Maps finished · ${String(Math.round((done / total) * 100))}%`}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          width: W,
          height: 56,
          marginTop: 20,
          borderRadius: 14,
          overflow: "hidden",
          backgroundColor: "rgba(255,255,255,0.07)",
        }}
      >
        {segs
          .filter(([, n]) => n > 0)
          .map(([l, n, c]) => (
            <div
              key={l}
              style={{
                width: Math.max(4, (n / total) * W),
                height: 56,
                backgroundColor: c,
                borderRight: `2px solid ${C.bg}`,
              }}
            />
          ))}
      </div>
      <div style={{ display: "flex", gap: 30, marginTop: 26, flexWrap: "wrap" }}>
        {segs.map(([l, n, c]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: c }} />
            <div style={{ fontFamily: "Bungee", fontSize: 36, color: c }}>{fmtN(n)}</div>
            <div style={{ fontSize: 26, color: C.dim, fontWeight: 600 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto", justifyContent: "flex-end" }}>
        <Brand />
      </div>
    </div>
  );
}

export const VARIANTS = {
  A: { label: "Share card, six tiles", draw: A, w: 1200, h: 630 },
  B: { label: "Medal cabinet", draw: B, w: 1200, h: 560 },
  C: { label: "Ball card (portrait)", draw: C3, w: 720, h: 1000 },
  D: { label: "Your places", draw: D, w: 1200, h: 630 },
  E: { label: "Collection bar", draw: E, w: 1200, h: 630 },
} as const;
export type VariantKey = keyof typeof VARIANTS;
export const isVariant = (k: string): k is VariantKey => k in VARIANTS;

type Fonts = NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"];
async function fonts(): Promise<Fonts> {
  const f = (file: string) => readFile(join(ASSETS, file));
  const [bungee, medium, semibold, bold] = await Promise.all([
    f("Bungee-Regular.ttf"),
    f("ChakraPetch-Medium.ttf"),
    f("ChakraPetch-SemiBold.ttf"),
    f("ChakraPetch-Bold.ttf"),
  ]);
  return [
    { name: "Bungee", data: bungee, weight: 400, style: "normal" },
    { name: "Chakra Petch", data: medium, weight: 500, style: "normal" },
    { name: "Chakra Petch", data: semibold, weight: 600, style: "normal" },
    { name: "Chakra Petch", data: bold, weight: 700, style: "normal" },
  ];
}

export async function drawStat(s: Stat, v: VariantKey) {
  const { draw: Draw, w, h } = VARIANTS[v];
  const png = await new ImageResponse(<Draw s={s} />, {
    width: w,
    height: h,
    fonts: await fonts(),
  }).arrayBuffer();
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}
