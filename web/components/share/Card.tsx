// Draws a ShareCard (lib/share.ts) as the 1200×630 PNG a link unfurls with, through
// next/og (Satori, then Resvg). Satori lays out flexbox only, reads TTF fonts and PNG, JPEG
// or SVG pictures (no WebP), and knows no oklch, so the theme's colours are restated here
// in sRGB and the fonts are TTF copies in assets/share/. A player gets the Split layout,
// their marble turned over to their avatar; a Map, Track or Daily gets the Banner, its
// picture across the top (docs/site.md, "Share images").
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { SITE_NAME } from "../../lib/rules";
import type { ShareCard, ShareStat, Tone } from "../../lib/share";

export const SHARE_ASSETS = join(process.cwd(), "assets", "share");

const W = 1200;
const H = 630;

/* base.css's tokens in sRGB */
const C = {
  bg: "#0a1020",
  bg2: "#16244a",
  text: "#eaf0ff",
  dim: "#93a2c8",
  gold: "#ffd447",
  author: "#5fd4ff",
  line: "rgba(150,175,245,0.18)",
  tile: "rgba(255,255,255,0.05)",
  pill: "rgba(10,16,32,0.72)",
};
const TONE: Record<Tone, string> = { gold: C.gold, author: C.author };
const toneOf = (s: ShareStat) => (s.tone ? TONE[s.tone] : C.text);

/* the Ball of components/Marble.tsx as an SVG picture: Satori runs no React hooks, so the
   component itself can't be drawn */
function ballSrc(h: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><radialGradient id="g" cx="34%" cy="27%" r="80%"><stop offset="0%" stop-color="hsl(${String(h)},94%,90%)"/><stop offset="34%" stop-color="hsl(${String(h)},80%,64%)"/><stop offset="100%" stop-color="hsl(${String(h)},62%,25%)"/></radialGradient><clipPath id="c"><circle cx="20" cy="20" r="19"/></clipPath></defs><circle cx="20" cy="20" r="19" fill="url(#g)"/><g clip-path="url(#c)"><path d="M-4 27C6 34 18 33 26 26s10-16 8-24" fill="none" stroke="hsl(${String(h)},66%,20%)" stroke-opacity=".26" stroke-width="4.5"/><path d="M2 8c8 2 16 8 19 17" fill="none" stroke="hsl(${String(h)},96%,92%)" stroke-opacity=".2" stroke-width="3"/></g><ellipse cx="13" cy="11.5" rx="5.4" ry="3.4" fill="#fff" fill-opacity=".62" transform="rotate(-28 13 11.5)"/><circle cx="20" cy="20" r="19" fill="none" stroke="hsl(${String(h)},60%,16%)" stroke-opacity=".35"/></svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

function Ball({ hue, size }: { hue: number; size: number }) {
  return <img src={ballSrc(hue)} width={size} height={size} alt="" />;
}

/* the brand's lime marble and the address */
function Brand({ size = 24 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Ball hue={96} size={size} />
      <div style={{ fontFamily: "Bungee", fontSize: size * 0.85, color: C.text, letterSpacing: 1 }}>
        {SITE_NAME}
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ display: "flex", padding: "8px 18px", borderRadius: 40, backgroundColor: C.pill }}
    >
      {children}
    </div>
  );
}

/* a long name steps down so it stays on one or two lines */
const titleSize = (t: string, big: number) =>
  t.length > 22 ? big * 0.62 : t.length > 14 ? big * 0.78 : big;

function Heading({ card, size, tight }: { card: ShareCard; size: number; tight?: boolean }) {
  const h = card.headline;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          fontSize: tight ? 22 : 24,
          color: C.dim,
          textTransform: "uppercase",
          letterSpacing: 3,
        }}
      >
        {card.kicker}
      </div>
      <div
        style={{ fontFamily: "Bungee", fontSize: titleSize(card.title, size), lineHeight: 1.05 }}
      >
        {card.title}
      </div>
      {h ? (
        <div style={{ display: "flex", gap: 14, fontSize: 30, fontWeight: 700, marginTop: 8 }}>
          <span style={{ color: toneOf(h) }}>{h.value}</span>
          <span style={{ color: C.dim, fontWeight: 600 }}>{h.label}</span>
        </div>
      ) : null}
    </div>
  );
}

function Tile({ s, big }: { s: ShareStat; big: number }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "18px 22px",
        borderRadius: 18,
        backgroundColor: C.tile,
        border: `2px solid ${C.line}`,
      }}
    >
      <div
        style={{
          fontFamily: "Bungee",
          fontSize: s.value.length > 6 ? big * 0.7 : big,
          lineHeight: 1.4,
          color: toneOf(s),
        }}
      >
        {s.value}
      </div>
      <div style={{ fontSize: 24, color: C.dim, fontWeight: 600 }}>{s.label}</div>
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

/* the marble caught mid-flip: the plain ball faint behind, the avatar in a ring of the
   player's hue popping out over it; a player with no avatar keeps the plain marble */
function TurnedOver({ hue, face, size }: { hue: number; face: string | null; size: number }) {
  if (!face) return <Ball hue={hue} size={size} />;
  const disc = size * 0.72;
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size }}>
      <div style={{ display: "flex", position: "absolute", left: 0, top: 0, opacity: 0.35 }}>
        <Ball hue={hue} size={size * 0.92} />
      </div>
      <div style={{ display: "flex", position: "absolute", right: 0, bottom: 0 }}>
        <img
          src={face}
          width={disc}
          height={disc}
          alt=""
          style={{
            borderRadius: disc,
            objectFit: "cover",
            border: `10px solid hsl(${String(hue)} 78% 58%)`,
          }}
        />
      </div>
    </div>
  );
}

/* a player: the marble on the left, the name and the tiles two to a row on the right, an
   odd last tile spanning its row */
function Split({ card, face }: { card: ShareCard; face: string | null }) {
  const rows: Array<Array<ShareStat>> = [];
  for (let i = 0; i < card.tiles.length; i += 2) rows.push(card.tiles.slice(i, i + 2));
  return (
    <div style={{ ...frame, padding: 48, gap: 44 }}>
      <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
        <TurnedOver hue={card.hue} face={face} size={400} />
        <div style={{ display: "flex", marginTop: "auto" }}>
          <Brand />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <Heading card={card} size={64} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: "auto" }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 16 }}>
              {r.map((s) => (
                <Tile key={s.label} s={s} big={50} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const BAND = 380;

/* a Map, Track or Daily: the picture as a band across the top, fading to the background
   under the name, and one row of tiles below */
function Banner({ card, banner }: { card: ShareCard; banner: string | null }) {
  const layer = { position: "absolute", left: 0, top: 0, width: W, height: BAND } as const;
  return (
    <div style={{ ...frame, flexDirection: "column" }}>
      <div style={{ display: "flex", width: W, height: BAND, position: "relative" }}>
        {banner ? (
          <img
            src={banner}
            width={W}
            height={BAND}
            alt=""
            style={{ ...layer, objectFit: "cover" }}
          />
        ) : null}
        <div
          style={{
            ...layer,
            display: "flex",
            backgroundImage: `linear-gradient(180deg, rgba(10,16,32,0) 30%, rgba(10,16,32,0.85) 85%, ${C.bg} 100%)`,
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
          <div style={{ display: "flex", marginTop: "auto" }}>
            <Heading card={card} size={70} tight />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 18, padding: "30px 56px 0" }}>
        {card.tiles.map((s) => (
          <Tile key={s.label} s={s} big={48} />
        ))}
      </div>
    </div>
  );
}

type Fonts = NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"];
let fonts: Promise<Fonts> | undefined;

/* Bungee for the display type and Chakra Petch for the rest, read once per instance */
function loadFonts() {
  const font = (file: string) => readFile(join(SHARE_ASSETS, file));
  fonts ??= Promise.all([
    font("Bungee-Regular.ttf"),
    font("ChakraPetch-Medium.ttf"),
    font("ChakraPetch-SemiBold.ttf"),
    font("ChakraPetch-Bold.ttf"),
  ]).then(([bungee, medium, semibold, bold]) => [
    { name: "Bungee", data: bungee, weight: 400, style: "normal" },
    { name: "Chakra Petch", data: medium, weight: 500, style: "normal" },
    { name: "Chakra Petch", data: semibold, weight: 600, style: "normal" },
    { name: "Chakra Petch", data: bold, weight: 700, style: "normal" },
  ]);
  return fonts;
}

/* The card as a PNG response. Vercel's CDN keeps a function's answer only under s-maxage,
   which ImageResponse's own header lacks; the page names the card with the latest Refresh
   in its URL, so a cached copy is never older than the link that asks for it. The picture
   is a data: URL (a player's Steam avatar, a place's Workshop preview or Track screenshot),
   or null to draw the card without one. A picture Satori can't read draws the card without
   it too, rather than a 500 no CDN keeps. */
export async function drawShare(
  card: ShareCard,
  picture: string | null,
  pictures: Array<string | null> = [],
) {
  try {
    return await render(card, picture, pictures);
  } catch (e) {
    if (!picture) throw e;
    console.warn(`share image ${card.kind} "${card.title}": drawn without its picture`, e);
    return render(card, null);
  }
}

async function render(
  card: ShareCard,
  picture: string | null,
  pictures: Array<string | null> = [],
) {
  const body =
    card.kind === "campaign" ? (
      <CampaignShare card={card} pics={pictures} />
    ) : card.kind === "player" ? (
      <Split card={card} face={picture} />
    ) : (
      <Banner card={card} banner={picture} />
    );
  /* ImageResponse draws as its body streams, so it is read here, where a failure can
     still be caught */
  const png = await new ImageResponse(body, {
    width: W,
    height: H,
    fonts: await loadFonts(),
  }).arrayBuffer();
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400",
    },
  });
}

/* PROTOTYPE (share round): a Campaign's card, four ways */
function Slices({
  pics,
  n,
  w,
  h,
}: {
  pics: Array<string | null>;
  n: number;
  w: number;
  h: number;
}) {
  const list = pics.slice(0, n);
  const each = (w - (list.length - 1) * 4) / list.length;
  return (
    <div style={{ display: "flex", gap: 4, width: w, height: h, backgroundColor: C.bg }}>
      {list.map((p, i) =>
        p ? (
          <img key={i} src={p} width={each} height={h} alt="" style={{ objectFit: "cover" }} />
        ) : (
          <div
            key={i}
            style={{ display: "flex", width: each, height: h, backgroundColor: C.tile }}
          />
        ),
      )}
    </div>
  );
}

/* the band across the top, fading under the name like the Banner's */
function SliceBand({
  card,
  pics,
  band,
}: {
  card: ShareCard;
  pics: Array<string | null>;
  band: number;
}) {
  const layer = { position: "absolute", left: 0, top: 0, width: W, height: band } as const;
  return (
    <div style={{ display: "flex", width: W, height: band, position: "relative" }}>
      <div style={{ ...layer, display: "flex" }}>
        <Slices pics={pics} n={5} w={W} h={band} />
      </div>
      <div
        style={{
          ...layer,
          display: "flex",
          backgroundImage: `linear-gradient(180deg, rgba(10,16,32,0) 25%, rgba(10,16,32,0.88) 82%, ${C.bg} 100%)`,
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
        <div style={{ display: "flex", marginTop: "auto" }}>
          <Heading card={card} size={70} tight />
        </div>
      </div>
    </div>
  );
}

const MEDAL = [C.gold, "#dfe5f2", "#e59a52"];

function CampaignShare({ card, pics }: { card: ShareCard; pics: Array<string | null> }) {
  const v = card.variant ?? "A";
  if (v === "B") {
    /* a mosaic of its Maps on the left, the name and tiles on the right */
    const grid = pics.length >= 9 ? 3 : 2;
    const cell = (420 - (grid - 1) * 6) / grid;
    const cells = pics.slice(0, grid * grid);
    return (
      <div style={{ ...frame, padding: 48, gap: 44 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 420 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              width: 420,
              borderRadius: 22,
              overflow: "hidden",
            }}
          >
            {cells.map((p, i) =>
              p ? (
                <img
                  key={i}
                  src={p}
                  width={cell}
                  height={cell}
                  alt=""
                  style={{ objectFit: "cover" }}
                />
              ) : (
                <div
                  key={i}
                  style={{ display: "flex", width: cell, height: cell, backgroundColor: C.tile }}
                />
              ),
            )}
          </div>
          <div style={{ display: "flex", marginTop: "auto" }}>
            <Brand />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <Heading card={card} size={64} />
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: "auto" }}>
            <div style={{ display: "flex", gap: 16 }}>
              {card.tiles.slice(0, 2).map((s) => (
                <Tile key={s.label} s={s} big={50} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              {card.tiles.slice(2).map((s) => (
                <Tile key={s.label} s={s} big={50} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (v === "C") {
    /* the band, then the top three on the podium */
    const pod = card.podium ?? [];
    return (
      <div style={{ ...frame, flexDirection: "column" }}>
        <SliceBand card={{ ...card, headline: null }} pics={pics} band={410} />
        <div style={{ display: "flex", gap: 18, padding: "34px 56px 0" }}>
          {pod.map((r, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "18px 22px",
                borderRadius: 18,
                backgroundColor: C.tile,
                border: `2px solid ${i === 0 ? C.gold : C.line}`,
              }}
            >
              <div style={{ display: "flex", fontFamily: "Bungee", fontSize: 44, color: MEDAL[i] }}>
                {String(i + 1)}
              </div>
              <Ball hue={r.hue} size={62} />
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ fontSize: 30, fontWeight: 700, color: C.text }}>
                  {r.name.length > 13 ? r.name.slice(0, 12) + "…" : r.name}
                </div>
                <div style={{ fontSize: 24, color: C.dim, fontWeight: 600 }}>
                  {r.points + " pts"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (v === "D") {
    /* the run of Maps itself: a numbered frame per Map under the name */
    const maps = card.maps ?? [];
    const named = maps.some((m) => !/^\d+$/.test(m));
    const n = Math.min(maps.length, 10);
    const each = (W - 112 - (n - 1) * 12) / n;
    return (
      <div style={{ ...frame, flexDirection: "column", padding: "44px 56px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Heading card={card} size={70} />
          <Brand size={22} />
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: "auto" }}>
          {maps.slice(0, n).map((name, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", width: each, gap: 8 }}>
              <div style={{ display: "flex", position: "relative", width: each, height: 150 }}>
                {pics[i] ? (
                  <img
                    src={pics[i]}
                    width={each}
                    height={150}
                    alt=""
                    style={{ objectFit: "cover", borderRadius: 12 }}
                  />
                ) : (
                  <div
                    style={{
                      display: "flex",
                      width: each,
                      height: 150,
                      borderRadius: 12,
                      backgroundColor: C.tile,
                    }}
                  />
                )}
                <div
                  style={{
                    position: "absolute",
                    left: 8,
                    top: 8,
                    display: "flex",
                    padding: "2px 10px",
                    borderRadius: 8,
                    backgroundColor: C.pill,
                    fontFamily: "Bungee",
                    fontSize: 22,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
              </div>
              {named ? (
                <div style={{ fontSize: n > 6 ? 18 : 22, color: C.dim, fontWeight: 600 }}>
                  {name.length > 12 ? name.slice(0, 11) + "…" : name}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            gap: 28,
            marginTop: 22,
            fontSize: 26,
            fontWeight: 600,
            color: C.dim,
          }}
        >
          {card.tiles.map((s) => (
            <div key={s.label} style={{ display: "flex", gap: 10 }}>
              <span style={{ color: toneOf(s), fontWeight: 700 }}>{s.value}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  /* A: the Map pictures as one split band, then the tiles */
  return (
    <div style={{ ...frame, flexDirection: "column" }}>
      <SliceBand card={card} pics={pics} band={380} />
      <div style={{ display: "flex", gap: 18, padding: "30px 56px 0" }}>
        {card.tiles.map((s) => (
          <Tile key={s.label} s={s} big={48} />
        ))}
      </div>
    </div>
  );
}
