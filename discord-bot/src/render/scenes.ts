// What each image looks like, as element trees for Satori (flexbox and CSS, no browser). The
// settled design is the prototype on branch claude/prototype-discord-bot-surfaces; check any
// change by eye with `pnpm render:samples`.
import {
  formatTime,
  MATCH_TYPE_NAME,
  type MedalKind,
  type Medals,
  type PbEvent,
  progress,
  SCORE_TICKS_PER_SECOND,
} from "../domain.js";
import type { CardView, Improvement, ProfilePreview } from "../ports.js";
import { boardRows, formatGap, mapTitle, matchDetails } from "../present.js";
import { hueFor, MEDAL_BAR, marbleSvg, medalHeight, medalSvg, svgUri } from "./art.js";

// ---------------------------------------------------------------- elements

type Style = Readonly<Record<string, string | number>>;
type Child = El | string | null;
export interface El {
  readonly type: string;
  readonly props: {
    readonly style?: Style;
    readonly children?: ReadonlyArray<Child>;
    readonly src?: string;
    readonly width?: number;
    readonly height?: number;
  };
}

/** A box; Satori needs every box with children to be flex. */
const box = (style: Style, ...children: ReadonlyArray<Child>): El => ({
  type: "div",
  props: { style: { display: "flex", ...style }, children: children.filter((c) => c !== null) },
});
const img = (src: string, width: number, height: number, style: Style = {}): El => ({
  type: "img",
  props: { src, width, height, style: { width, height, ...style } },
});
const marble = (hue: number, size: number, style: Style = {}) =>
  img(svgUri(marbleSvg(hue, size)), size, size, style);
const medal = (kind: MedalKind, size: number) =>
  img(svgUri(medalSvg(kind, size)), size, medalHeight(size));

// ---------------------------------------------------------------- the site's theme

const C = {
  bg: "#0a1020",
  surface: "rgba(255,255,255,0.05)",
  solid: "#111a2c",
  line: "rgba(150,175,245,0.18)",
  line2: "rgba(255,255,255,0.055)",
  text: "#eaf0ff",
  dim: "#93a2c8",
  faint: "#63719a",
  accent: "#8be03c",
  accentInk: "#0d2000",
  gold: "#ffd447",
  silver: "#d3dcea",
  bronze: "#ef9a52",
} as const;

const F = { medal: "Nunito", hud: "Chakra Petch", body: "Archivo", marquee: "Bungee" } as const;

/** The game's black outline on white lettering. */
const OUTLINE = "-1px -1px 0 #111, 1px -1px 0 #111, -1px 1px 0 #111, 1px 1px 0 #111, 0 2px 0 #111";

const backdrop = (style: Style, ...children: ReadonlyArray<Child>) =>
  box(
    {
      flexDirection: "column",
      color: C.text,
      fontFamily: F.body,
      fontSize: 14,
      backgroundColor: C.bg,
      backgroundImage:
        "radial-gradient(circle at 85% -20%, rgba(88,168,255,0.18), transparent 45%), radial-gradient(circle at 0% 0%, rgba(139,224,60,0.10), transparent 40%)",
      borderRadius: 8,
      overflow: "hidden",
      ...style,
    },
    ...children,
  );

const label = (text: string, style: Style = {}) =>
  box(
    {
      fontFamily: F.hud,
      fontWeight: 600,
      fontSize: 10,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: C.dim,
      ...style,
    },
    text,
  );

const logo = () =>
  box(
    { alignItems: "center", gap: 8 },
    box(
      {},
      marble(212, 16),
      marble(332, 16, { marginLeft: -6 }),
      marble(96, 16, { marginLeft: -6 }),
    ),
    box({ fontFamily: F.marquee, fontSize: 12, letterSpacing: 0.3 }, "Multiballs"),
  );

const chip = (text: string, style: Style = {}, lead: El | null = null) =>
  box(
    {
      alignItems: "center",
      fontFamily: F.hud,
      fontWeight: 700,
      fontSize: 10,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      borderRadius: 999,
      padding: "3px 9px",
      border: `1px solid ${C.line}`,
      color: C.dim,
      ...style,
    },
    lead,
    text,
  );

// ---------------------------------------------------------------- formatting

/** A medal target in seconds, as the medal bars show it: 14.200, or 1:02.500 past a minute. */
const formatTarget = (seconds: number) =>
  formatTime(seconds * SCORE_TICKS_PER_SECOND).replace(/^0:/, "");

const PLACE_COLOUR = [C.gold, C.silver, C.bronze];
const placeColour = (rank: number | null) =>
  rank === null ? C.dim : (PLACE_COLOUR[rank - 1] ?? C.dim);

// ---------------------------------------------------------------- the Match Card ("In-game Screen")

export const CARD_WIDTH = 520;

export interface CardImage {
  readonly view: CardView;
  /** Each Player's display name, by Discord id. */
  readonly names: ReadonlyMap<string, string>;
  /** The Workshop preview as a data URI, or null to draw the stand-in art. */
  readonly preview: string | null;
}

const check = () =>
  img(
    svgUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15"><circle cx="7.5" cy="7.5" r="7.5" fill="#111"/><path d="M4.2 7.8l2.2 2.2 4.4-4.6" fill="none" stroke="${C.gold}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    ),
    15,
    15,
  );

/** The game's four medal bars. */
const ladder = (medals: Medals) =>
  box(
    { flexDirection: "column", gap: 4 },
    ...(["bronze", "silver", "gold", "author"] as const).map((kind) =>
      box(
        { borderRadius: 3, overflow: "hidden", fontFamily: F.medal },
        box(
          {
            flexGrow: 1,
            alignItems: "center",
            gap: 6,
            padding: "2px 8px",
            backgroundImage: MEDAL_BAR[kind],
            color: "#fff",
            fontSize: 15,
            fontWeight: 900,
            textShadow: OUTLINE,
          },
          check(),
          kind,
        ),
        box(
          {
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#1f1f22",
            color: "#fff",
            fontWeight: 800,
            fontSize: 14,
            padding: "2px 12px",
            minWidth: 76,
          },
          formatTarget(medals[kind]),
        ),
      ),
    ),
  );

const ART = "linear-gradient(170deg, #3b7dd8 0%, #7fb6f2 45%, #f5c58a 70%, #e0874a 100%)";

const picture = (card: CardImage, height: number) => {
  const fill: Style = { position: "absolute", left: 0, top: 0, width: CARD_WIDTH, height };
  if (card.view.state === "invite")
    return box(
      {
        ...fill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: C.solid,
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 12px, rgba(255,255,255,0.06) 12px, rgba(255,255,255,0.06) 24px)",
        fontFamily: F.marquee,
        fontSize: 28,
        color: C.faint,
      },
      "?",
    );
  return card.preview === null
    ? box({ ...fill, backgroundImage: ART })
    : img(card.preview, CARD_WIDTH, height, { ...fill, objectFit: "cover" });
};

/** The Card's rows, from the shared Board Slab (present.ts). */
const rowsOf = (card: CardImage) => boardRows(card.view, (id) => card.names.get(id) ?? "Player");

const COLUMNS = { rank: 34, marble: 24 } as const;

const slab = (card: CardImage) => {
  const invite = card.view.state === "invite";
  return box(
    {
      flexDirection: "column",
      border: `1px solid ${C.line}`,
      borderRadius: 11,
      overflow: "hidden",
      backgroundColor: C.solid,
    },
    box(
      {
        alignItems: "center",
        gap: 10,
        padding: "5px 12px",
        backgroundColor: "rgba(255,255,255,0.035)",
      },
      label(invite ? "Slot" : "Rank", { width: COLUMNS.rank }),
      box({ width: COLUMNS.marble }),
      label("Player", { flexGrow: 1 }),
      label(invite ? "" : "Time"),
    ),
    ...rowsOf(card).map((r) =>
      box(
        {
          alignItems: "center",
          gap: 10,
          padding: "0 12px",
          minHeight: 44,
          borderTop: `1px solid ${C.line2}`,
          color: r.faded ? C.faint : C.text,
        },
        box(
          {
            width: COLUMNS.rank,
            fontFamily: F.hud,
            fontWeight: 600,
            fontSize: 14,
            color: r.faded ? C.faint : placeColour(r.place),
          },
          r.rank,
        ),
        marble(r.steamId === null ? 0 : hueFor(r.steamId), 24, r.faded ? { opacity: 0.25 } : {}),
        box(
          { flexGrow: 1, flexDirection: "column", minWidth: 0 },
          box(
            {
              fontWeight: 600,
              fontSize: 14.5,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            },
            r.name,
          ),
          r.note === ""
            ? null
            : box({ fontFamily: F.hud, fontWeight: 500, fontSize: 10.5, color: C.faint }, r.note),
        ),
        box(
          { alignItems: "center", gap: 8, fontFamily: F.hud, fontWeight: 600, fontSize: 16 },
          r.score,
          r.worldRecord ? wrRibbon() : r.medal === null ? null : medal(r.medal, 16),
        ),
      ),
    ),
  );
};

const stateChip = (view: CardView) =>
  view.state === "invite"
    ? chip(`Invite · ${view.minutes}:00`)
    : view.state === "live" && view.waitingForSteam
      ? chip("Time's up")
      : view.state === "live"
        ? chip(
            "Live",
            {
              backgroundColor: C.accent,
              color: C.accentInk,
              border: "1px solid transparent",
              gap: 5,
            },
            box({ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accentInk }),
          )
        : chip("Final", { color: C.gold, border: "1px solid rgba(255,212,71,0.4)" });

export const cardScene = (card: CardImage): El => {
  const { view } = card;
  const height = view.state === "invite" ? 110 : 150;
  const title = mapTitle(view);
  const meta = matchDetails(view);
  return backdrop(
    { width: CARD_WIDTH },
    box(
      { position: "relative", width: CARD_WIDTH, height },
      picture(card, height),
      box({
        position: "absolute",
        left: 0,
        top: 0,
        width: CARD_WIDTH,
        height,
        backgroundImage: "linear-gradient(90deg, rgba(10,16,32,0.88), rgba(10,16,32,0.15) 65%)",
      }),
      box(
        {
          position: "absolute",
          left: 0,
          top: 0,
          width: Math.round(CARD_WIDTH * 0.56),
          height,
          padding: "14px 16px",
          flexDirection: "column",
          justifyContent: "space-between",
        },
        logo(),
        box(
          { flexDirection: "column", alignItems: "flex-start" },
          box(
            {
              fontFamily: F.medal,
              fontWeight: 900,
              fontSize: 24,
              lineHeight: 1.1,
              textShadow: OUTLINE,
            },
            title,
          ),
          box(
            { fontFamily: F.hud, fontWeight: 500, fontSize: 11.5, color: C.dim, marginTop: 2 },
            meta,
          ),
          box({ marginTop: 6 }, stateChip(view)),
        ),
      ),
      view.state === "invite" || view.map === null
        ? null
        : box(
            { position: "absolute", right: 10, top: 10, width: 200, flexDirection: "column" },
            ladder(view.map.medals),
          ),
    ),
    box(
      { flexDirection: "column", padding: "2px 16px 14px" },
      box({ marginTop: 10, flexDirection: "column" }, slab(card)),
    ),
  );
};

// ---------------------------------------------------------------- an Improvement row ("Gold Edge", Big Rank)

export const ROW_WIDTH = 420;

/** A WR in the game's gold: the medal bar's gradient and its outlined lettering. */
const wrRibbon = () =>
  box(
    {
      alignItems: "center",
      padding: "1px 6px",
      borderRadius: 3,
      border: "1.5px solid #111",
      backgroundImage: MEDAL_BAR.gold,
      fontFamily: F.medal,
      fontWeight: 900,
      fontSize: 12,
      color: "#fff",
      textShadow: OUTLINE,
    },
    "WR",
  );

/** "Gold Takeover": a PB that beat the world record, as the game's gold medal bar. */
const worldRecordScene = (improvement: Improvement, name: string, beaten: number): El =>
  box(
    {
      width: ROW_WIDTH,
      height: 56,
      alignItems: "center",
      borderRadius: 8,
      backgroundImage: MEDAL_BAR.gold,
      fontFamily: F.medal,
      fontWeight: 900,
      color: "#fff",
      textShadow: OUTLINE,
    },
    box({ width: 58, justifyContent: "center", fontSize: 24 }, "WR"),
    marble(hueFor(improvement.player.steamId), 28),
    box(
      { flexGrow: 1, flexDirection: "column", marginLeft: 10, minWidth: 0 },
      box(
        { fontSize: 15, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
        name,
      ),
      box(
        { fontFamily: F.hud, fontWeight: 700, fontSize: 11, color: "#3a2a00", textShadow: "none" },
        `beat ${formatTime(beaten)} by ${formatGap(beaten - improvement.ticks)}`,
      ),
    ),
    box({ fontSize: 22, paddingRight: 16 }, formatTime(improvement.ticks)),
  );

export const improvementScene = (improvement: Improvement, name: string): El => {
  if (improvement.beatWorldRecord !== null)
    return worldRecordScene(improvement, name, improvement.beatWorldRecord);
  const lead = improvement.rank === 1;
  const diff =
    improvement.previousTicks === null
      ? null
      : `-${formatGap(improvement.previousTicks - improvement.ticks)}`;
  return backdrop(
    {
      width: ROW_WIDTH,
      flexDirection: "row",
      alignItems: "center",
      minHeight: 44,
      borderLeft: `4px solid ${lead ? C.gold : C.line}`,
      ...(lead
        ? { backgroundImage: "linear-gradient(90deg, rgba(255,212,71,0.16), transparent 70%)" }
        : {}),
    },
    box(
      {
        width: 58,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: F.hud,
        fontWeight: 700,
        fontSize: 22,
        color: lead ? C.gold : C.dim,
      },
      `P${improvement.rank}`,
    ),
    box(
      { flexGrow: 1, alignItems: "center", gap: 10, paddingRight: 12, minHeight: 44 },
      marble(hueFor(improvement.player.steamId), 24),
      box(
        {
          flexGrow: 1,
          fontWeight: 600,
          fontSize: 14.5,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        },
        name,
      ),
      box(
        { alignItems: "center", gap: 8, fontFamily: F.hud, fontWeight: 600, fontSize: 16 },
        formatTime(improvement.ticks),
        diff === null ? null : box({ fontSize: 13, color: C.accent }, diff),
        improvement.medal === null ? null : medal(improvement.medal, 16),
      ),
    ),
  );
};

// ---------------------------------------------------------------- the Footer ("How It Works")

export const FOOTER_WIDTH = 520;

const STEPS = [
  ["1", "Pick a mode", "Public 1v1, Challenge or Lobby"],
  ["2", "Map is drawn", "A Map no one here has finished"],
  ["3", "Fastest wins", "best time when the clock runs out"],
] as const;

export const footerScene = (): El =>
  backdrop(
    { width: FOOTER_WIDTH, padding: "14px 16px" },
    box({ alignItems: "center", justifyContent: "space-between" }, logo(), chip("5–60 min")),
    box(
      { gap: 8, marginTop: 10 },
      ...STEPS.map(([n, title, detail]) =>
        box(
          {
            flexDirection: "column",
            flexGrow: 1,
            flexBasis: 0,
            backgroundColor: C.surface,
            border: `1px solid ${C.line}`,
            borderRadius: 9,
            padding: "7px 10px",
          },
          box({ fontFamily: F.hud, fontWeight: 600, fontSize: 18, color: C.accent }, n),
          box({ fontWeight: 700, fontSize: 13 }, title),
          box({ fontSize: 11, color: C.faint }, detail),
        ),
      ),
    ),
    box(
      {
        justifyContent: "center",
        marginTop: 10,
        fontFamily: F.hud,
        fontWeight: 500,
        fontSize: 11.5,
        color: C.faint,
      },
      "Unofficial community tool · not made or supported by the Ballest developers",
    ),
  );

// ---------------------------------------------------------------- the Link confirmation

export const LINK_WIDTH = 400;

export const linkScene = (preview: ProfilePreview): El =>
  backdrop(
    {
      width: LINK_WIDTH,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: "14px 16px",
    },
    marble(hueFor(preview.steamId), 48),
    box(
      { flexDirection: "column", width: LINK_WIDTH - 32 - 48 - 12 },
      box({ fontFamily: F.hud, fontWeight: 700, fontSize: 17 }, preview.personaName),
      box(
        { fontFamily: F.hud, fontWeight: 500, fontSize: 11.5, color: C.faint, marginTop: 2 },
        `SteamID ${preview.steamId} · times on ${preview.campaignTracks} of ${preview.campaignTrackTotal} Circuit Tracks`,
      ),
    ),
  );

// ---------------------------------------------------------------- the progression graph ("Staircase")

export const PROGRESSION_WIDTH = 520;

export interface ProgressionImage {
  readonly view: CardView;
  readonly history: ReadonlyArray<PbEvent>;
  /** Each Player's display name, by Discord id. */
  readonly names: ReadonlyMap<string, string>;
}

const MEDAL_COLOUR: Record<MedalKind, string> = {
  bronze: C.bronze,
  silver: C.silver,
  gold: C.gold,
  author: "#b36be8",
};
const MEDAL_ORDER: ReadonlyArray<MedalKind> = ["bronze", "silver", "gold", "author"];

const starPath = (x: number, y: number, r: number) => {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? "L" : "M"}${(x + rr * Math.cos(a)).toFixed(1)} ${(y + rr * Math.sin(a)).toFixed(1)}`;
  }
  return `<path d="${d}Z" fill="${C.gold}" stroke="#111" stroke-width="1.2"/>`;
};

/** A line of text placed like SVG text: `x` is where it starts, ends or centres, `y` its baseline. */
const textAt = (
  x: number,
  y: number,
  text: string,
  style: Style,
  anchor: "start" | "end" | "middle" = "start",
): El => {
  const size = typeof style.fontSize === "number" ? style.fontSize : 10;
  const place: Style =
    anchor === "start"
      ? { left: x }
      : anchor === "end"
        ? { right: PROGRESSION_WIDTH - x }
        : { left: x - 60, width: 120, justifyContent: "center" };
  return box(
    {
      position: "absolute",
      top: y - size * 0.82,
      lineHeight: 1,
      whiteSpace: "nowrap",
      ...style,
      ...place,
    },
    text,
  );
};

/**
 * Labels for points down the chart, kept at least `gap` apart: pushed down in order from no higher
 * than `top`, then back up from `bottom`. Each comes back with `labelY`, where it goes.
 */
const spread = <A extends { readonly y: number }>(
  labels: ReadonlyArray<A>,
  gap: number,
  top: number,
  bottom: number,
): Array<A & { labelY: number }> => {
  const placed = [...labels].sort((a, b) => a.y - b.y).map((l) => ({ ...l, labelY: l.y }));
  for (let i = 0; i < placed.length; i++) {
    const prev = placed[i - 1],
      cur = placed[i];
    if (cur !== undefined)
      cur.labelY = Math.max(cur.labelY, prev === undefined ? top : prev.labelY + gap);
  }
  for (let i = placed.length - 1; i >= 0; i--) {
    const cur = placed[i],
      next = placed[i + 1];
    if (cur !== undefined)
      cur.labelY = Math.min(cur.labelY, next === undefined ? bottom : next.labelY - gap);
  }
  return placed;
};

const clockLabel = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

/**
 * Every Player's PB over the Match clock as a step line, with the medals in range and the world
 * record from the start of the Match as dotted lines (each break of it a star), and any PB a
 * Player brought into the Match dotted in until they beat it.
 */
export const progressionScene = ({ view, history, names }: ProgressionImage): El => {
  const W = PROGRESSION_WIDTH,
    H = 470,
    L = 78,
    R = 150,
    T = 100,
    B = 58;
  const map = view.map;
  const secs = (ticks: number) => ticks / SCORE_TICKS_PER_SECOND;
  const label10 = (ticks: number) => formatGap(ticks);
  const duration = view.minutes * 60;
  const wr = map === null ? Infinity : secs(map.worldRecordTicks);
  const personalBests = map?.personalBests ?? {};
  const times = [...history.map((e) => secs(e.ticks)), ...Object.values(personalBests).map(secs)];
  // The scale covers every PB and the WR; medals outside it are listed above the chart.
  const pad = Math.max(0.3, (Math.max(...times) - Math.min(wr, ...times)) * 0.04);
  const hi = Math.max(...times) + pad;
  const x = (t: number) => L + (Math.min(t, duration) / duration) * (W - L - R);
  // Logarithmic from just under the fastest time: close finishes get room, a slow first run still fits.
  const bottom = Math.min(wr, ...times) - 0.15;
  const floor = bottom - Math.max(0.5, pad);
  const f = (s: number) => Math.log(Math.max(s, bottom) - floor);
  const y = (s: number) => T + ((f(hi) - f(Math.min(s, hi))) / (f(hi) - f(bottom))) * (H - T - B);
  const nameOf = (steamId: string) => {
    const p = view.players.find((pl) => pl.steamId === steamId);
    return p === undefined ? "Player" : (names.get(p.discordId) ?? "Player");
  };
  const colourOf = (steamId: string) => `hsl(${hueFor(steamId)},78%,60%)`;

  let lines = "";
  const overlays: Array<El> = [];
  const tick = duration >= 1200 ? 300 : 120;
  for (let t = 0; t <= duration; t += tick) {
    lines += `<line x1="${x(t)}" y1="${T}" x2="${x(t)}" y2="${H - B}" stroke="rgba(255,255,255,0.05)"/>`;
    overlays.push(
      textAt(
        x(t),
        H - B + 16,
        clockLabel(t),
        { fontFamily: F.hud, fontSize: 10, color: C.faint },
        "middle",
      ),
    );
  }

  const above: Array<string> = [];
  const leftLabels: Array<{ y: number; text: string; style: Style; medal: MedalKind | null }> = [];
  if (map !== null)
    for (const kind of MEDAL_ORDER) {
      const v = map.medals[kind];
      if (v > hi) {
        above.push(`${kind} ${label10(v * SCORE_TICKS_PER_SECOND)}`);
        continue;
      }
      lines += `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="${MEDAL_COLOUR[kind]}" stroke-opacity="0.55" stroke-width="1.2" stroke-dasharray="2 4"/>`;
      leftLabels.push({
        y: y(v),
        text: label10(v * SCORE_TICKS_PER_SECOND),
        style: { fontFamily: F.hud, fontSize: 10, color: MEDAL_COLOUR[kind] },
        medal: kind,
      });
    }
  if (above.length > 0)
    overlays.push(
      textAt(L, T - 10, `▲ above the chart: ${above.join(" · ")}`, {
        fontFamily: F.hud,
        fontSize: 10,
        color: C.faint,
      }),
    );

  // Each PB that beat the world record standing at the time.
  const breaks =
    map === null ? [] : progress(map, history).filter((e) => e.beatWorldRecord !== null);
  if (map !== null) {
    lines += `<line x1="${L}" y1="${y(wr)}" x2="${W - R}" y2="${y(wr)}" stroke="#fff" stroke-dasharray="2 4" stroke-width="1.3"/>`;
    leftLabels.push({
      y: y(wr),
      text: `WR ${label10(map.worldRecordTicks)}`,
      style: { fontFamily: F.hud, fontWeight: 700, fontSize: 10, color: "#fff" },
      medal: null,
    });
  }

  // Where each Player's line meets the right edge, for their name in the legend.
  const lineEnds = new Map<string, number>();
  for (const player of view.players) {
    const pts = history.filter((e) => e.steamId === player.steamId);
    const colour = colourOf(player.steamId);
    const pb = personalBests[player.steamId];
    const first = pts[0];
    const last = pts.at(-1)?.ticks ?? pb;
    if (last !== undefined) lineEnds.set(player.steamId, y(secs(last)));
    if (pb !== undefined)
      lines += `<line x1="${x(0)}" y1="${y(secs(pb))}" x2="${x(first === undefined ? duration : first.at / 1000)}" y2="${y(secs(pb))}" stroke="${colour}" stroke-width="1.6" stroke-dasharray="2 3"/>`;
    if (first === undefined) continue;
    let d = `M${x(first.at / 1000)} ${y(secs(first.ticks))}`;
    for (const e of pts.slice(1)) d += `H${x(e.at / 1000)}V${y(secs(e.ticks))}`;
    lines += `<path d="${d}H${x(duration)}" fill="none" stroke="${colour}" stroke-width="2.3" stroke-linejoin="round"/>`;
    for (const e of pts)
      lines += `<circle cx="${x(e.at / 1000)}" cy="${y(secs(e.ticks))}" r="2.8" fill="${colour}" stroke="${C.bg}" stroke-width="1"/>`;
  }
  for (const e of breaks)
    lines += `<circle cx="${x(e.at / 1000)}" cy="${y(secs(e.ticks))}" r="15" fill="${C.gold}" fill-opacity="0.18"/>${starPath(x(e.at / 1000), y(secs(e.ticks)), 10)}`;

  // At least a line apart.
  for (const l of spread(leftLabels, 13, -Infinity, H - B + 4)) {
    if (Math.abs(l.labelY - l.y) > 2)
      lines += `<path d="M${L - 6} ${l.labelY}L${L} ${l.y}" stroke="${String(l.style.color)}" stroke-opacity="0.6"/>`;
    if (l.medal !== null)
      overlays.push(
        img(svgUri(medalSvg(l.medal, 11)), 11, medalHeight(11), {
          position: "absolute",
          left: L - 19,
          top: l.labelY - 8,
        }),
      );
    overlays.push(textAt(L - 24, l.labelY + 3.5, l.text, l.style, "end"));
  }

  // Each line's Player named beside where it ends: slower times sit higher. Names with their
  // time a row below while they fit, else the name alone, packed as tight as it takes.
  const ends = view.standings.flatMap((s) => {
    const end = lineEnds.get(s.player.steamId) ?? (s.ticks === null ? undefined : y(secs(s.ticks)));
    return end === undefined ? [] : [{ y: end, standing: s }];
  });
  const ROW = 36,
    TIGHT_ROW = 18,
    legendBottom = H - B - 8;
  const roomy = (ends.length - 1) * ROW <= legendBottom - T;
  const legend = spread(
    ends,
    roomy ? ROW : Math.min(TIGHT_ROW, (legendBottom - T) / (ends.length - 1)),
    T,
    legendBottom,
  );
  for (const { y: end, labelY, standing } of legend)
    if (Math.abs(labelY - end) > 2)
      lines += `<path d="M${W - R} ${end}L${W - R + 10} ${labelY + 1}" stroke="${colourOf(standing.player.steamId)}" stroke-opacity="0.6"/>`;

  const chart = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${lines}</svg>`;
  const holder = breaks.at(-1)?.steamId;
  const untimed = view.standings.filter((s) => s.ticks === null && !lineEnds.has(s.player.steamId));

  return backdrop(
    { width: W, height: H, position: "relative" },
    img(svgUri(chart), W, H, { position: "absolute", left: 0, top: 0 }),
    ...overlays,
    box(
      { position: "absolute", left: 16, top: 12, width: W - 32, flexDirection: "column" },
      box({ justifyContent: "space-between", alignItems: "center" }, logo(), label("Progression")),
      box(
        { fontFamily: F.medal, fontWeight: 900, fontSize: 20, textShadow: OUTLINE, marginTop: 8 },
        map?.title ?? "Match",
      ),
      box(
        { fontFamily: F.hud, fontWeight: 500, fontSize: 10.5, color: C.dim },
        `${view.minutes}-minute ${MATCH_TYPE_NAME[view.type]} · WR at the start ${map === null ? "none" : label10(map.worldRecordTicks)} · every PB as it happened`,
      ),
    ),
    ...legend.map(({ labelY, standing: s }) => {
      const id = s.player.steamId;
      const time = `${s.ticks === null ? "no time" : formatTime(s.ticks)}${id === holder ? "  ★ new WR" : ""}`;
      return box(
        {
          position: "absolute",
          left: W - R + 12,
          top: labelY - (roomy ? 8 : 5),
          width: R - 24,
          gap: roomy ? 8 : 6,
          alignItems: roomy ? "flex-start" : "center",
        },
        marble(hueFor(id), roomy ? 16 : 11, roomy ? { marginTop: 1 } : {}),
        box(
          { flexDirection: "column", flexShrink: 1, minWidth: 0 },
          box(
            {
              fontWeight: 600,
              fontSize: roomy ? 11 : 10,
              ...(roomy ? {} : { lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden" }),
              color: !roomy && id === holder ? C.gold : C.text,
            },
            nameOf(id),
          ),
          roomy
            ? box(
                {
                  fontFamily: F.hud,
                  fontWeight: 600,
                  fontSize: 10,
                  color: id === holder ? C.gold : C.dim,
                },
                time,
              )
            : null,
        ),
      );
    }),
    untimed.length === 0
      ? null
      : textAt(L, H - 12, `No time: ${untimed.map((s) => nameOf(s.player.steamId)).join(", ")}`, {
          fontFamily: F.hud,
          fontSize: 10,
          color: C.faint,
        }),
  );
};

// ---------------------------------------------------------------- the Activity's art
// The images uploaded to the Developer Portal (Activities -> Art Assets, and the app icon), written
// by `pnpm render:activity-art`. The settled design is the prototype on branch claude/prototype-activity-art:
// the logo's three marbles racked in a triangle, pink at the front. Scenes are laid out at half
// size; the renderer draws them at twice that.

export type ActivityArt = "icon" | "cover" | "background";

/** Layout sizes: a 1024 icon, and a 1920x1080 cover and grid-view background. */
export const ACTIVITY_ART_SIZE: Record<ActivityArt, readonly [width: number, height: number]> = {
  icon: [512, 512],
  cover: [960, 540],
  background: [960, 540],
};

const LOGO_HUES = { blue: 212, pink: 332, lime: 96 } as const;

/** Art drawn in a 1600x900 (or 1024 square) SVG, placed over the whole scene. */
const artSvg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const placedMarble = (hue: number, cx: number, cy: number, r: number, id: string) =>
  `<g transform="translate(${cx - r} ${cy - r})">${marbleSvg(hue, r * 2, id)}</g>`;
const floorShadow = (cx: number, cy: number, rx: number) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * 0.22}" fill="#000" opacity=".5"/>`;
const glow = (
  id: string,
  cx: string,
  cy: string,
  r: string,
  color: string,
  opacity: number,
  w: number,
  h: number,
) =>
  `<defs><radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#${id})"/>`;

/** The cover: the rack under one soft light, on a lit floor. Everything sits inside the 13:11 centre crop (x 268..1332). */
const coverArt = () =>
  artSvg(
    1600,
    900,
    `<rect width="1600" height="900" fill="#070c18"/>` +
      glow("spot", "50%", "38%", "55%", "#3a5fa8", 0.55, 1600, 900) +
      `<ellipse cx="800" cy="610" rx="544" ry="63" fill="#8fb4ff" opacity=".10"/>` +
      floorShadow(640, 610, 130) +
      floorShadow(960, 610, 130) +
      floorShadow(800, 640, 140) +
      placedMarble(LOGO_HUES.blue, 640, 460, 140, "b") +
      placedMarble(LOGO_HUES.lime, 960, 460, 140, "l") +
      placedMarble(LOGO_HUES.pink, 800, 500, 150, "p"),
  );

/** The icon: the same triangle filling the circle Discord masks it to, on flat navy. */
const iconArt = () =>
  artSvg(
    1024,
    1024,
    `<rect width="1024" height="1024" fill="${C.bg}"/>` +
      placedMarble(LOGO_HUES.blue, 318, 380, 236, "b") +
      placedMarble(LOGO_HUES.lime, 706, 380, 236, "l") +
      placedMarble(LOGO_HUES.pink, 512, 700, 250, "p"),
  );

/** Grid view: the Activity page's navy glow, with a marble cropped into three corners and the centre clear for Discord's tiles. */
const backgroundArt = () =>
  artSvg(
    1600,
    900,
    `<rect width="1600" height="900" fill="${C.bg}"/>` +
      glow("blue", "80%", "-10%", "75%", "#58a8ff", 0.3, 1600, 900) +
      glow("lime", "4%", "4%", "65%", "#8be03c", 0.18, 1600, 900) +
      placedMarble(LOGO_HUES.blue, 60, 40, 260, "b") +
      placedMarble(LOGO_HUES.pink, 1580, 880, 300, "p") +
      placedMarble(LOGO_HUES.lime, 1560, 60, 170, "l"),
  );

/** "DEV", on the dev app's art so the two apps tell apart on the test server's shelf. */
const devTag = (fontSize: number) =>
  box(
    {
      fontFamily: F.hud,
      fontWeight: 700,
      fontSize,
      letterSpacing: fontSize * 0.14,
      color: C.accentInk,
      backgroundColor: C.accent,
      borderRadius: fontSize * 0.4,
      padding: `${fontSize * 0.12}px ${fontSize * 0.45}px`,
    },
    "DEV",
  );

export const activityArtScene = (art: ActivityArt, dev: boolean): El => {
  const [w, h] = ACTIVITY_ART_SIZE[art];
  const svg = art === "icon" ? iconArt() : art === "cover" ? coverArt() : backgroundArt();
  return box(
    { position: "relative", width: w, height: h, backgroundColor: C.bg },
    img(svgUri(svg), w, h, { position: "absolute", left: 0, top: 0 }),
    art === "cover"
      ? box(
          {
            position: "absolute",
            left: 0,
            top: 432,
            width: w,
            justifyContent: "center",
            fontFamily: F.marquee,
            fontSize: 47,
            letterSpacing: 1.4,
            color: C.text,
          },
          "MULTI",
          box({ color: C.accent }, "BALLS"),
        )
      : null,
    // The icon's tag sits bottom centre, where the circle mask keeps it; the cover's sits inside the 13:11 crop.
    dev && art === "icon"
      ? box(
          { position: "absolute", left: 0, bottom: 34, width: w, justifyContent: "center" },
          devTag(60),
        )
      : null,
    dev && art === "cover"
      ? box({ position: "absolute", right: 180, bottom: 22 }, devTag(26))
      : null,
  );
};

// ---------------------------------------------------------------- the Daily Report's standings

export const STANDINGS_WIDTH = 620;
/** Widest a name gets before it is clipped, so a row stays on one line. */
const STANDINGS_NAME = 20;

/** The four boards of the Daily Report (src/report/), two by two, ten rows each. */
export interface StandingsImage {
  readonly title: string;
  readonly subtitle: string;
  readonly boards: ReadonlyArray<{
    readonly title: string;
    readonly rows: ReadonlyArray<{ readonly name: string; readonly n: number }>;
  }>;
}

export const standingsScene = ({ title, subtitle, boards }: StandingsImage): El => {
  const column = (board: StandingsImage["boards"][number]) =>
    box(
      { flexDirection: "column", width: 270, gap: 4 },
      label(board.title, { fontSize: 13, letterSpacing: 1.4, marginBottom: 6 }),
      ...board.rows.map((row, i) =>
        box(
          {
            alignItems: "center",
            gap: 8,
            fontSize: 15,
            padding: "3px 8px",
            borderRadius: 6,
            backgroundColor: i === 0 ? "rgba(139,224,60,0.16)" : C.surface,
          },
          box(
            { width: 22, color: i < 3 ? C.gold : C.faint, fontFamily: F.hud, fontWeight: 700 },
            String(i + 1),
          ),
          box(
            { flexGrow: 1, overflow: "hidden" },
            row.name.length > STANDINGS_NAME
              ? `${row.name.slice(0, STANDINGS_NAME - 1)}…`
              : row.name,
          ),
          box({ fontFamily: F.hud, fontWeight: 700, color: C.text }, String(row.n)),
        ),
      ),
      board.rows.length === 0 ? box({ color: C.faint, fontSize: 14 }, "Nobody yet") : null,
    );
  const pairs = [boards.slice(0, 2), boards.slice(2, 4)].filter((p) => p.length > 0);
  return backdrop(
    { padding: 28, gap: 20 },
    box(
      { flexDirection: "column", gap: 4 },
      box({ fontFamily: F.marquee, fontSize: 28 }, title),
      box({ color: C.dim, fontSize: 14 }, subtitle),
    ),
    ...pairs.map((pair) => box({ gap: 24 }, ...pair.map(column))),
  );
};
