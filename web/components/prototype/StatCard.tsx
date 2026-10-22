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
  s1: { rank: number } | null;
  /* the Chosen Skin's picture (prototype: ?skin=<asset>), or null for the hue marble */
  skin: string | null;
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
    s1: rec.seasons.find((s) => s.group === "Season 1")?.overall ?? null,
    skin: null,
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

/* ---------- Round 2: the ball card (round 1's C won) ---------- */

/* a prototype tier, by Author medals (WRs lift it to the top): the rule itself is a later
   question */
type Tier = { name: string; from: string; to: string; ink: string };
function tierOf(s: Stat): Tier {
  if (s.wr >= 25) return { name: "RECORD HOLDER", from: "#d8ff6a", to: "#3c7d12", ink: "#14200a" };
  if (s.author >= 100) return { name: "AUTHOR", from: "#5ef0f5", to: "#8a4fd0", ink: "#0a1020" };
  if (s.author >= 20) return { name: "GOLD", from: "#fff7b0", to: "#c99a00", ink: "#2a2000" };
  if (s.finished >= 20) return { name: "SILVER", from: "#ffffff", to: "#7a7a7a", ink: "#1a1a1a" };
  return { name: "BRONZE", from: "#f9cb85", to: "#8a5a17", ink: "#2a1800" };
}

const CW = 720;
const CH = 1000;

function Plate({ children, bg }: { children: React.ReactNode; bg: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "10px 0",
        borderRadius: 14,
        backgroundColor: bg,
        fontFamily: "Bungee",
      }}
    >
      {children}
    </div>
  );
}

function Row({ k, label, n, hue }: { k: MedalKind | null; label: string; n: number; hue: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "5px 14px",
        borderBottom: `2px solid ${C.line}`,
        opacity: n ? 1 : 0.4,
      }}
    >
      <div style={{ display: "flex", width: 40, justifyContent: "center" }}>
        {k ? <Medal k={k} size={28} /> : <Ball hue={hue} size={28} />}
      </div>
      <div style={{ fontSize: 30, color: C.dim, fontWeight: 600, flex: 1 }}>{label}</div>
      <div style={{ fontFamily: "Bungee", fontSize: 38, color: k ? MEDAL_COLOUR[k] : C.text }}>
        {fmtN(n)}
      </div>
    </div>
  );
}

/* R1 · Rarity frame: round 1's card, its frame coloured by the player's tier (named on a
   ribbon) instead of their marble's hue, every Medal on its own row */
function R1({ s }: { s: Stat }) {
  const t = tierOf(s);
  return (
    <div
      style={{
        ...frame(CW, CH),
        padding: 22,
        backgroundImage: `linear-gradient(150deg, ${t.from}, ${t.to})`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          borderRadius: 28,
          backgroundColor: C.bg,
          padding: "24px 30px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand size={20} />
          <div
            style={{
              display: "flex",
              padding: "4px 16px",
              borderRadius: 30,
              fontFamily: "Bungee",
              fontSize: 22,
              color: t.ink,
              backgroundImage: `linear-gradient(90deg, ${t.from}, ${t.to})`,
            }}
          >
            {t.name}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          <Face s={s} size={290} ring={10} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
          <Plate bg="rgba(255,255,255,0.08)">
            <div style={{ fontSize: nameSize(s.name, 50) }}>{s.name}</div>
          </Plate>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 14 }}>
          {MEDALS.map(([k, l, n]) => (
            <Row key={k} k={k} label={l} n={n(s)} hue={s.hue} />
          ))}
          <Row k={null} label="Maps finished" n={s.finished} hue={s.hue} />
        </div>
      </div>
    </div>
  );
}

/* R2 · Footballer: one big number top left (Season 2 rank) over the player's face, the name
   on a band, and six short stats two columns wide, as on a football card */
function R2({ s }: { s: Stat }) {
  const t = tierOf(s);
  const grid: Array<[string, number, string]> = [
    ["WR", s.wr, C.accent],
    ["AUT", s.author, "#8fa2f0"],
    ["GLD", s.gold, "#ffe600"],
    ["SLV", s.silver, "#c9c9c9"],
    ["BRZ", s.bronze, "#e0a650"],
    ["MAP", s.finished, C.text],
  ];
  return (
    <div
      style={{
        ...frame(CW, CH),
        flexDirection: "column",
        padding: 40,
        borderRadius: 0,
        backgroundImage: `linear-gradient(170deg, ${t.from} 0%, ${t.to} 55%, #0a1020 100%)`,
      }}
    >
      <div style={{ display: "flex", height: 420 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 200, color: t.ink }}>
          <div
            style={{
              fontFamily: "Bungee",
              fontSize: s.s2 && s.s2.rank > 999 ? 66 : 96,
              lineHeight: 1,
            }}
          >
            {s.s2 ? `#${fmtN(s.s2.rank)}` : "—"}
          </div>
          <div style={{ fontFamily: "Bungee", fontSize: 30 }}>SEASON 2</div>
          <div style={{ display: "flex", marginTop: 24 }}>
            <Ball hue={s.hue} size={70} />
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>
          <Face s={s} size={400} ring={0} />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: 26,
          paddingBottom: 14,
          borderBottom: `3px solid rgba(255,255,255,0.35)`,
          fontFamily: "Bungee",
          fontSize: nameSize(s.name, 60),
        }}
      >
        {s.name}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", marginTop: 22, rowGap: 14 }}>
        {grid.map(([l, n, c]) => (
          <div key={l} style={{ display: "flex", width: 320, alignItems: "baseline", gap: 16 }}>
            <div
              style={{
                fontFamily: "Bungee",
                fontSize: 54,
                color: c,
                width: 170,
                justifyContent: "flex-end",
                display: "flex",
              }}
            >
              {fmtN(n)}
            </div>
            <div style={{ fontFamily: "Bungee", fontSize: 34, color: C.dim }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto", justifyContent: "center" }}>
        <Brand size={20} />
      </div>
    </div>
  );
}

/* R3 · Art window: the face as a big square picture, name on a bar across its foot, then
   round 1's Medal cabinet as one shelf, and a single line of totals */
function R3({ s }: { s: Stat }) {
  const hue = String(s.hue);
  return (
    <div
      style={{
        ...frame(CW, CH),
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
          padding: 22,
        }}
      >
        <div style={{ display: "flex", position: "relative", width: 632, height: 520 }}>
          {s.face ? (
            <img
              src={s.face}
              width={632}
              height={520}
              alt=""
              style={{ borderRadius: 18, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: 632,
                height: 520,
                justifyContent: "center",
                alignItems: "center",
                borderRadius: 18,
                backgroundColor: C.tile,
              }}
            >
              <Ball hue={s.hue} size={360} />
            </div>
          )}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 22px",
              borderRadius: "0 0 18px 18px",
              backgroundColor: "rgba(10,16,32,0.82)",
            }}
          >
            <div style={{ fontFamily: "Bungee", fontSize: nameSize(s.name, 46) }}>{s.name}</div>
            {s.s2 ? (
              <div style={{ fontFamily: "Bungee", fontSize: 30, color: C.gold }}>
                {`#${fmtN(s.s2.rank)}`}
              </div>
            ) : null}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 26,
            padding: "0 6px",
          }}
        >
          {MEDALS.map(([k, , n]) => (
            <div
              key={k}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: 118,
                opacity: n(s) ? 1 : 0.35,
              }}
            >
              <Medal k={k} size={64} />
              <div
                style={{
                  fontFamily: "Bungee",
                  fontSize: n(s) > 999 ? 34 : 44,
                  color: MEDAL_COLOUR[k],
                }}
              >
                {fmtN(n(s))}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 14,
            fontSize: 28,
            color: C.dim,
            fontWeight: 600,
          }}
        >
          {`${fmtN(s.finished)} Maps finished · ${fmtN(s.made)} made`}
        </div>
        <div style={{ display: "flex", marginTop: "auto", justifyContent: "center" }}>
          <Brand size={18} />
        </div>
      </div>
    </div>
  );
}

/* R4 · Two heroes: the player's marble huge with their face as a badge on it, then World
   records and Author medals as two big numbers, and Gold, Silver and Bronze small beneath */
function R4({ s }: { s: Stat }) {
  const hue = String(s.hue);
  const hero = (k: MedalKind, n: number, l: string) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Medal k={k} size={46} />
        <div
          style={{
            fontFamily: "Bungee",
            fontSize: n > 999 ? 72 : 88,
            color: MEDAL_COLOUR[k],
            lineHeight: 1,
          }}
        >
          {fmtN(n)}
        </div>
      </div>
      <div style={{ fontSize: 28, color: C.dim, fontWeight: 600 }}>{l}</div>
    </div>
  );
  return (
    <div
      style={{
        ...frame(CW, CH),
        flexDirection: "column",
        alignItems: "center",
        padding: "34px 34px 28px",
        border: `16px solid hsl(${hue} 70% 50%)`,
        backgroundImage: `radial-gradient(circle at 50% 28%, hsl(${hue} 60% 30%) 0%, ${C.bg} 60%)`,
      }}
    >
      <div style={{ display: "flex", position: "relative", width: 380, height: 380 }}>
        <Ball hue={s.hue} size={380} />
        <div style={{ display: "flex", position: "absolute", right: -20, bottom: -10 }}>
          {s.face ? (
            <img
              src={s.face}
              width={140}
              height={140}
              alt=""
              style={{ borderRadius: 140, border: `8px solid ${C.bg}` }}
            />
          ) : null}
        </div>
      </div>
      <div style={{ fontFamily: "Bungee", fontSize: nameSize(s.name, 58), marginTop: 18 }}>
        {s.name}
      </div>
      <div style={{ fontSize: 28, color: C.dim, fontWeight: 600 }}>
        {`${fmtN(s.finished)} Maps finished${s.s2 ? ` · #${fmtN(s.s2.rank)} Season 2` : ""}`}
      </div>
      <div style={{ display: "flex", width: "100%", marginTop: 30 }}>
        {hero("wr", s.wr, "World records")}
        {hero("author", s.author, "Author medals")}
      </div>
      <div style={{ display: "flex", gap: 40, marginTop: 30 }}>
        {(["gold", "silver", "bronze"] as const).map((k) => (
          <div
            key={k}
            style={{ display: "flex", alignItems: "center", gap: 10, opacity: s[k] ? 1 : 0.4 }}
          >
            <Medal k={k} size={30} />
            <div style={{ fontFamily: "Bungee", fontSize: 40, color: MEDAL_COLOUR[k] }}>
              {fmtN(s[k])}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto" }}>
        <Brand size={18} />
      </div>
    </div>
  );
}

/* R5 · Front and back: the card's face beside its back in one landscape picture, which
   Discord shows about twice as big as a tall one. Front: face, name, rank. Back: every
   count as rows. */
function R5({ s }: { s: Stat }) {
  const hue = String(s.hue);
  const card = (children: React.ReactNode, back?: boolean) => (
    <div
      style={{
        display: "flex",
        width: 560,
        height: 780,
        padding: 18,
        borderRadius: 30,
        backgroundImage: back
          ? `linear-gradient(160deg, hsl(${hue} 40% 30%), hsl(${hue} 50% 14%))`
          : `linear-gradient(160deg, hsl(${hue} 70% 55%), hsl(${hue} 60% 22%))`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          borderRadius: 22,
          backgroundColor: C.bg,
          padding: 26,
        }}
      >
        {children}
      </div>
    </div>
  );
  return (
    <div style={{ ...frame(1240, 860), alignItems: "center", justifyContent: "center", gap: 40 }}>
      {card(
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Brand size={18} />
            {s.s2 ? (
              <div
                style={{ fontFamily: "Bungee", fontSize: 30, color: C.gold }}
              >{`#${fmtN(s.s2.rank)}`}</div>
            ) : null}
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 40 }}>
            <Face s={s} size={360} ring={12} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
            <Plate bg={`hsl(${hue} 60% 30%)`}>
              <div style={{ fontSize: nameSize(s.name, 50) }}>{s.name}</div>
            </Plate>
          </div>
        </div>,
      )}
      {card(
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontFamily: "Bungee", fontSize: 30, color: C.dim, marginBottom: 12 }}>
            STATS
          </div>
          {MEDALS.map(([k, l, n]) => (
            <Row key={k} k={k} label={l} n={n(s)} hue={s.hue} />
          ))}
          <Row k={null} label="Maps finished" n={s.finished} hue={s.hue} />
          <Row k={null} label="Podiums" n={s.podiums} hue={s.hue} />
          <Row k={null} label="Maps made" n={s.made} hue={s.hue} />
        </div>,
        true,
      )}
    </div>
  );
}

/* ---------- Round 3: C4's ball over C1's rows, Circuit ranks first ---------- */

export async function skinOf(asset: string | null) {
  if (!asset || !/^DA_[A-Za-z0-9_]+$/.test(asset)) return null;
  try {
    const png = await readFile(join(ASSETS, "proto-skins", asset + ".png"));
    return "data:image/png;base64," + png.toString("base64");
  } catch {
    return null;
  }
}

/* the big ball: the Chosen Skin's picture, else the hue marble, with the Steam avatar as a
   badge on its lower right */
function BigBall({ s, size, badge }: { s: Stat; size: number; badge: number }) {
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size }}>
      {s.skin ? (
        <img src={s.skin} width={size} height={size} alt="" />
      ) : (
        <Ball hue={s.hue} size={size} />
      )}
      {s.face ? (
        <div
          style={{
            display: "flex",
            position: "absolute",
            right: -badge * 0.12,
            bottom: -badge * 0.05,
          }}
        >
          <img
            src={s.face}
            width={badge}
            height={badge}
            alt=""
            style={{
              borderRadius: badge,
              border: `${String(Math.round(badge / 18))}px solid ${C.bg}`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/* a season's mark in place of a Medal on a rank row */
function Season({ n, size }: { n: 1 | 2; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        borderRadius: size * 0.28,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: n === 2 ? C.accent : "#7d8fbf",
        color: C.bg,
        fontFamily: "Bungee",
        fontSize: size * 0.42,
      }}
    >
      {`S${String(n)}`}
    </div>
  );
}

type Line = { icon: React.ReactNode; label: string; value: string; colour: string; zero: boolean };
function linesOf(s: Stat, size: number): Array<Line> {
  const rank = (r: { rank: number } | null) => (r ? `#${fmtN(r.rank)}` : "—");
  return [
    {
      icon: <Season n={1} size={size} />,
      label: "Season 1 Circuit",
      value: rank(s.s1),
      colour: C.gold,
      zero: !s.s1,
    },
    {
      icon: <Season n={2} size={size} />,
      label: "Season 2 Circuit",
      value: rank(s.s2),
      colour: C.gold,
      zero: !s.s2,
    },
    ...MEDALS.map(([k, l, n]) => ({
      icon: <Medal k={k} size={size} />,
      label: k === "author" ? "Author medals" : k === "wr" ? l : `${l} medals`,
      value: fmtN(n(s)),
      colour: MEDAL_COLOUR[k],
      zero: n(s) === 0,
    })),
    {
      icon: <Ball hue={s.hue} size={size} />,
      label: "Maps finished",
      value: fmtN(s.finished),
      colour: C.text,
      zero: s.finished === 0,
    },
  ];
}

function LineRow({ l, font, hideZero }: { l: Line; font: number; hideZero?: boolean }) {
  if (hideZero && l.zero) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "4px 12px",
        borderBottom: `2px solid ${C.line}`,
        opacity: l.zero ? 0.4 : 1,
      }}
    >
      <div style={{ display: "flex", width: font * 1.3, justifyContent: "center" }}>{l.icon}</div>
      <div style={{ fontSize: font, color: C.dim, fontWeight: 600, flex: 1 }}>{l.label}</div>
      <div style={{ fontFamily: "Bungee", fontSize: font * 1.25, color: l.colour }}>{l.value}</div>
    </div>
  );
}

const Name = ({ s, size }: { s: Stat; size: number }) => (
  <div style={{ display: "flex", fontFamily: "Bungee", fontSize: nameSize(s.name, size) }}>
    {s.name}
  </div>
);

/* K1 · Straight merge: C4 as it was (solid frame in the player's colour, glow behind the
   ball), its numbers swapped for C1's eight rows */
function K1({ s }: { s: Stat }) {
  const hue = String(s.hue);
  return (
    <div
      style={{
        ...frame(720, 1040),
        flexDirection: "column",
        alignItems: "center",
        padding: "28px 30px 22px",
        border: `16px solid hsl(${hue} 70% 50%)`,
        backgroundImage: `radial-gradient(circle at 50% 22%, hsl(${hue} 60% 30%) 0%, ${C.bg} 55%)`,
      }}
    >
      <BigBall s={s} size={300} badge={116} />
      <div style={{ display: "flex", marginTop: 12 }}>
        <Name s={s} size={54} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignSelf: "stretch",
          gap: 2,
          marginTop: 14,
        }}
      >
        {linesOf(s, 28).map((l) => (
          <LineRow key={l.label} l={l} font={28} />
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto" }}>
        <Brand size={18} />
      </div>
    </div>
  );
}

/* K2 · Two shelves: C1's gradient frame round a dark card; the rows split under two small
   headings, Circuit (the two ranks) and Medals */
function K2({ s }: { s: Stat }) {
  const hue = String(s.hue);
  const lines = linesOf(s, 28);
  const head = (t: string) => (
    <div
      style={{
        display: "flex",
        fontFamily: "Bungee",
        fontSize: 20,
        color: C.dim,
        letterSpacing: 2,
        marginTop: 12,
        marginBottom: 2,
      }}
    >
      {t}
    </div>
  );
  return (
    <div
      style={{
        ...frame(720, 1060),
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
          padding: "22px 28px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <BigBall s={s} size={270} badge={104} />
          <div style={{ display: "flex", marginTop: 10 }}>
            <Name s={s} size={50} />
          </div>
        </div>
        {head("CIRCUIT")}
        {lines.slice(0, 2).map((l) => (
          <LineRow key={l.label} l={l} font={28} />
        ))}
        {head("MEDALS & MAPS")}
        {lines.slice(2).map((l) => (
          <LineRow key={l.label} l={l} font={28} />
        ))}
        <div style={{ display: "flex", marginTop: "auto", justifyContent: "center" }}>
          <Brand size={18} />
        </div>
      </div>
    </div>
  );
}

/* K3 · Breaking out: the ball overlaps the top of a lighter stats panel, the name in the
   gap; the rows sit on the panel */
function K3({ s }: { s: Stat }) {
  const hue = String(s.hue);
  return (
    <div
      style={{
        ...frame(720, 1060),
        flexDirection: "column",
        alignItems: "center",
        padding: "30px 30px 22px",
        backgroundImage: `linear-gradient(180deg, hsl(${hue} 55% 34%) 0%, ${C.bg} 46%)`,
        border: `10px solid hsl(${hue} 70% 50%)`,
      }}
    >
      <Name s={s} size={56} />
      <div style={{ display: "flex", marginTop: 14, marginBottom: -110, zIndex: 1 }}>
        <BigBall s={s} size={310} badge={112} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignSelf: "stretch",
          padding: "124px 8px 12px",
          borderRadius: 26,
          backgroundColor: "rgba(255,255,255,0.06)",
          border: `2px solid ${C.line}`,
        }}
      >
        {linesOf(s, 27).map((l) => (
          <LineRow key={l.label} l={l} font={27} />
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto" }}>
        <Brand size={18} />
      </div>
    </div>
  );
}

/* K4 · Ranks by the ball: the ball top left, the name and the two Circuit ranks big beside
   it, then the Medal rows full width; shorter, so Discord draws it larger */
function K4({ s }: { s: Stat }) {
  const hue = String(s.hue);
  const lines = linesOf(s, 30);
  return (
    <div
      style={{
        ...frame(760, 900),
        flexDirection: "column",
        padding: "30px 32px 22px",
        border: `16px solid hsl(${hue} 70% 50%)`,
        backgroundImage: `radial-gradient(circle at 25% 20%, hsl(${hue} 60% 30%) 0%, ${C.bg} 50%)`,
      }}
    >
      <div style={{ display: "flex", gap: 26, alignItems: "center" }}>
        <BigBall s={s} size={270} badge={100} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 12 }}>
          <Name s={s} size={46} />
          {lines.slice(0, 2).map((l) => (
            <div
              key={l.label}
              style={{ display: "flex", alignItems: "center", gap: 14, opacity: l.zero ? 0.4 : 1 }}
            >
              {l.icon}
              <div style={{ fontFamily: "Bungee", fontSize: 46, color: l.colour }}>{l.value}</div>
              <div style={{ fontSize: 22, color: C.dim, fontWeight: 600 }}>Circuit</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 22 }}>
        {lines.slice(2).map((l) => (
          <LineRow key={l.label} l={l} font={30} />
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto", justifyContent: "center" }}>
        <Brand size={18} />
      </div>
    </div>
  );
}

/* K5 · Huge ball, zeros hidden: the ball as big as the card allows and only the rows a
   player has (a missing rank or a count of zero leaves its row out) */
function K5({ s }: { s: Stat }) {
  const hue = String(s.hue);
  return (
    <div
      style={{
        ...frame(720, 1060),
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 30px 22px",
        border: `16px solid hsl(${hue} 70% 50%)`,
        backgroundImage: `radial-gradient(circle at 50% 24%, hsl(${hue} 60% 30%) 0%, ${C.bg} 58%)`,
      }}
    >
      <BigBall s={s} size={400} badge={130} />
      <div style={{ display: "flex", marginTop: 10 }}>
        <Name s={s} size={56} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignSelf: "stretch",
          gap: 2,
          marginTop: 10,
        }}
      >
        {linesOf(s, 27).map((l) => (
          <LineRow key={l.label} l={l} font={27} hideZero />
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto" }}>
        <Brand size={18} />
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
  C1: { label: "Rarity frame", draw: R1, w: CW, h: CH },
  C2: { label: "Footballer", draw: R2, w: CW, h: CH },
  C3: { label: "Art window", draw: R3, w: CW, h: CH },
  C4: { label: "Two heroes", draw: R4, w: CW, h: CH },
  C5: { label: "Front and back", draw: R5, w: 1240, h: 860 },
  K1: { label: "Straight merge", draw: K1, w: 720, h: 1040 },
  K2: { label: "Two shelves", draw: K2, w: 720, h: 1060 },
  K3: { label: "Breaking out", draw: K3, w: 720, h: 1060 },
  K4: { label: "Ranks by the ball", draw: K4, w: 760, h: 900 },
  K5: { label: "Huge ball, zeros hidden", draw: K5, w: 720, h: 1060 },
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
  return new Response(png, {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
