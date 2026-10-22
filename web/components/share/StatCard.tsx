// Draws a StatCard (lib/stat-card.ts), with the pictures it names, as the 720×1060 portrait
// PNG See my stats answers with, through next/og like Card.tsx and under the same limits (no
// WebP, no oklch). The grill-design winner K5 with its date as T1 (prototype branch
// claude/prototype-statcard): a frame and glow in the player's hue, their ball huge with their
// Steam avatar as a badge, their name, the rows they have, and the date and the brand along the
// foot.
import type { StatCard, StatRowKind } from "../../lib/stat-card";
import { SITE_NAME } from "../../lib/rules";
import { Ball, C, pngOf } from "./Card";
import { fetchPicture, fullAvatar, skinShot } from "./pictures";

const W = 720;
const H = 1060;
/* the ball, its avatar badge, and a row's type size */
const BALL = 400;
const BADGE = 130;
const FONT = 27;
/* the lime of the site's own marble: a world record and Season 2's mark */
const ACCENT = "#b8f04a";

const uri = (svg: string) => "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");

type MedalKind = "wr" | "author" | "gold" | "silver" | "bronze";
const STOPS: Record<Exclude<MedalKind, "wr">, [string, string, string]> = {
  bronze: ["#9c6c1f", "#e0a650", "#f9cb85"],
  silver: ["#7a7a7a", "#c9c9c9", "#ffffff"],
  gold: ["#e0b800", "#ffe600", "#fff7b0"],
  author: ["#b86ae6", "#8fa2f0", "#5ef0f5"],
};

/* a Medal on its ribbon, a world record as a lime 1. The 1 is a path: Resvg draws an SVG
   picture with no fonts on Vercel, where a <text> comes out as a box */
function medalSrc(k: MedalKind) {
  const ribbon = `<path d="M4 0h5l3 9H7z" fill="#1c2a4a"/><path d="M11 0h5l-3 9H8z" fill="#2d4476"/>`;
  if (k === "wr")
    return uri(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 26">${ribbon}<circle cx="10" cy="16.5" r="8.4" fill="${ACCENT}" stroke="#ffd447" stroke-width="1.6"/><path d="M7.9 14.2l2.9-1.9h1.6v8.3h-2v-5.6l-1.6 1z" fill="#14200a"/></svg>`,
    );
  const [dark, mid, light] = STOPS[k];
  return uri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 26"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>${ribbon}<circle cx="10" cy="16.5" r="8.4" fill="url(#m)" stroke="#111" stroke-width="1.4"/><circle cx="10" cy="16.5" r="5.4" fill="none" stroke="#111" stroke-opacity=".28" stroke-width="1.2"/></svg>`,
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
        backgroundColor: n === 2 ? ACCENT : "#7d8fbf",
        color: C.bg,
        fontFamily: "Bungee",
        fontSize: size * 0.42,
      }}
    >
      {`S${String(n)}`}
    </div>
  );
}

/* each row's mark and the colour its value is set in */
function markOf(kind: StatRowKind, hue: number, size: number): [React.ReactNode, string] {
  switch (kind) {
    case "s1":
      return [<Season n={1} size={size} />, C.gold];
    case "s2":
      return [<Season n={2} size={size} />, C.gold];
    case "finished":
      return [<Ball hue={hue} size={size} />, C.text];
    default:
      return [
        <img src={medalSrc(kind)} width={size} height={Math.round(size * 1.3)} alt="" />,
        kind === "wr" ? ACCENT : STOPS[kind][1],
      ];
  }
}

function Row({ kind, label, value, hue }: StatCard["rows"][number] & { hue: number }) {
  const [mark, colour] = markOf(kind, hue, FONT);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "4px 12px",
        borderBottom: `2px solid ${C.line}`,
      }}
    >
      <div style={{ display: "flex", width: FONT * 1.3, justifyContent: "center" }}>{mark}</div>
      <div style={{ fontSize: FONT, color: C.dim, fontWeight: 600, flex: 1 }}>{label}</div>
      <div style={{ fontFamily: "Bungee", fontSize: FONT * 1.25, color: colour }}>{value}</div>
    </div>
  );
}

/* the ball: the Chosen Skin's picture, else the hue marble, with the Steam avatar as a badge
   on its lower right; no avatar, no badge */
function BigBall({
  card,
  skin,
  face,
}: {
  card: StatCard;
  skin: string | null;
  face: string | null;
}) {
  return (
    <div style={{ display: "flex", position: "relative", width: BALL, height: BALL }}>
      {skin ? (
        <img src={skin} width={BALL} height={BALL} alt="" />
      ) : (
        <Ball hue={card.hue} size={BALL} />
      )}
      {face ? (
        <div
          style={{
            display: "flex",
            position: "absolute",
            right: -BADGE * 0.12,
            bottom: -BADGE * 0.05,
          }}
        >
          <img
            src={face}
            width={BADGE}
            height={BADGE}
            alt=""
            style={{
              borderRadius: BADGE,
              border: `${String(Math.round(BADGE / 18))}px solid ${C.bg}`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/* the name's line: the card inside its frame and padding */
const NAME_WIDTH = W - 2 * 16 - 2 * 30;
const NAME_SIZE = 56;
/* Bungee's widest letters (M, W) in ems: a name sized for them fits whatever its letters */
const BUNGEE_WIDEST = 0.85;
/* what Bungee doesn't have (an emoji, a CJK character, any other script) falls back to a
   wider face: a square glyph and some, in ems */
const WIDE = 1.25;
/* Latin letters, their accents, digits and punctuation: what Bungee draws itself */
const LATIN = /^[\u0020-\u024f\u1e00-\u1eff\u2000-\u206f\p{M}]+$/u;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/* A long name steps down so it stays on one line: up to 32 characters (as a reader counts
   them, so an emoji of several code points is one), Steam's longest persona, fit at 23px in
   Latin and smaller in wide glyphs; anything longer is cut with an ellipsis. */
export function nameSize(name: string) {
  const ems = [...graphemes.segment(name)]
    .slice(0, 32)
    .reduce((sum, { segment }) => sum + (LATIN.test(segment) ? BUNGEE_WIDEST : WIDE), 0);
  return Math.min(NAME_SIZE, Math.floor(NAME_WIDTH / ems));
}

function Portrait({
  card,
  skin,
  face,
}: {
  card: StatCard;
  skin: string | null;
  face: string | null;
}) {
  const hue = String(card.hue);
  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        position: "relative",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 30px 22px",
        fontFamily: "Chakra Petch",
        color: C.text,
        backgroundColor: C.bg,
        border: `16px solid hsl(${hue} 70% 50%)`,
        backgroundImage: `radial-gradient(circle at 50% 24%, hsl(${hue} 60% 30%) 0%, ${C.bg} 58%)`,
      }}
    >
      <BigBall card={card} skin={skin} face={face} />
      <div
        style={{
          display: "flex",
          maxWidth: NAME_WIDTH,
          marginTop: 10,
          fontFamily: "Bungee",
          fontSize: nameSize(card.name),
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {card.name}
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
        {card.rows.map((r) => (
          <Row key={r.kind} {...r} hue={card.hue} />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          alignSelf: "stretch",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontFamily: "Bungee", fontSize: 22, color: C.text }}>{card.date}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Ball hue={96} size={18} />
          <div
            style={{ fontFamily: "Bungee", fontSize: 18 * 0.85, color: C.dim, letterSpacing: 1 }}
          >
            {SITE_NAME}
          </div>
        </div>
      </div>
    </div>
  );
}

/* The Stat Card's CDN life: minutes, not the share images' year, since the Chosen Skin and
   the Steam avatar on it change between Refreshes; a card drawn without an avatar that failed
   only for now is never kept, so the next press draws it again (docs/site.md, "Stat Card") */
const CARD_CACHE = "public, max-age=300, s-maxage=300";
const NO_STORE = "no-store";

/* The card as a PNG response, drawn with the pictures it names: its Skin's and its Steam
   avatar, each left off when it fails to load. Only an avatar that failed for now (timed out,
   a 5xx, the network) keeps the card from the CDN (NO_STORE); a picture that will never load
   (no PNG for the Skin, an address safeImg refuses, a 404) is kept as drawn. One Satori can't
   read draws the card without either, rather than a 500. */
export async function drawStatCard(card: StatCard) {
  const [skin, avatar] = await Promise.all([
    card.skin ? skinShot(card.skin) : null,
    fetchPicture(fullAvatar(card.avatar)),
  ]);
  const face = avatar.src;
  const cache = avatar.temporary ? NO_STORE : CARD_CACHE;
  try {
    return await pngOf(<Portrait card={card} skin={skin} face={face} />, W, H, cache);
  } catch (e) {
    if (!skin && !face) throw e;
    console.warn(`stat card "${card.name}": drawn without its pictures`, e);
    return pngOf(<Portrait card={card} skin={null} face={null} />, W, H, cache);
  }
}
