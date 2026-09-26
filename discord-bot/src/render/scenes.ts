// What each image looks like, as element trees for Satori (flexbox and CSS, no browser). The
// settled design is the prototype on branch claude/prototype-discord-bot-surfaces; check any
// change by eye with `pnpm render:samples`.
import { type MatchType, type MedalKind, type Medals, SCORE_TICKS_PER_SECOND } from "../domain.js"
import type { CardView, Improvement, ProfilePreview } from "../ports.js"
import { hueFor, MEDAL_BAR, marbleSvg, medalSvg, svgUri } from "./art.js"

// ---------------------------------------------------------------- elements

type Style = Readonly<Record<string, string | number>>
type Child = El | string | null
export interface El {
  readonly type: string
  readonly props: { readonly style?: Style; readonly children?: ReadonlyArray<Child>; readonly src?: string; readonly width?: number; readonly height?: number }
}

/** A box; Satori needs every box with children to be flex. */
const box = (style: Style, ...children: ReadonlyArray<Child>): El => ({
  type: "div",
  props: { style: { display: "flex", ...style }, children: children.filter((c) => c !== null) }
})
const img = (src: string, width: number, height: number, style: Style = {}): El => ({
  type: "img",
  props: { src, width, height, style: { width, height, ...style } }
})
const marble = (hue: number, size: number, style: Style = {}) => img(svgUri(marbleSvg(hue, size)), size, size, style)
const medal = (kind: MedalKind, size: number) => img(svgUri(medalSvg(kind, size)), size, Math.round(size * 1.3))

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
  bronze: "#ef9a52"
} as const

const F = { medal: "Nunito", hud: "Chakra Petch", body: "Archivo", marquee: "Bungee" } as const

/** The game's black outline on white lettering. */
const OUTLINE = "-1px -1px 0 #111, 1px -1px 0 #111, -1px 1px 0 #111, 1px 1px 0 #111, 0 2px 0 #111"

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
      ...style
    },
    ...children
  )

const label = (text: string, style: Style = {}) =>
  box({ fontFamily: F.hud, fontWeight: 600, fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase", color: C.dim, ...style }, text)

const logo = () =>
  box(
    { alignItems: "center", gap: 8 },
    box({}, marble(212, 16), marble(332, 16, { marginLeft: -6 }), marble(96, 16, { marginLeft: -6 })),
    box({ fontFamily: F.marquee, fontSize: 12, letterSpacing: 0.3 }, "Multiballs")
  )

const chip = (text: string, style: Style = {}) =>
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
      ...style
    },
    text
  )

// ---------------------------------------------------------------- formatting

const TYPE_NAME: Record<MatchType, string> = { public: "Public 1v1", challenge: "Challenge", lobby: "Lobby" }

/** m:ss.mmm, as the leaderboard site writes times. */
export const formatTime = (ticks: number): string => {
  const totalMs = Math.round((ticks / SCORE_TICKS_PER_SECOND) * 1000)
  const m = Math.floor(totalMs / 60_000)
  const s = Math.floor((totalMs % 60_000) / 1000)
  return `${m}:${String(s).padStart(2, "0")}.${String(totalMs % 1000).padStart(3, "0")}`
}
/** A medal target in seconds, as the medal bars show it: 14.200, or 1:02.500 past a minute. */
const formatTarget = (seconds: number) => formatTime(seconds * SCORE_TICKS_PER_SECOND).replace(/^0:/, "")
const formatSeconds = (ticks: number) => (ticks / SCORE_TICKS_PER_SECOND).toFixed(3)

const PLACE_COLOUR = [C.gold, C.silver, C.bronze]
const placeColour = (rank: number | null) => (rank === null ? C.dim : (PLACE_COLOUR[rank - 1] ?? C.dim))

// ---------------------------------------------------------------- the Match Card ("In-game Screen")

export const CARD_WIDTH = 520

export interface CardImage {
  readonly view: CardView
  /** Each Player's display name, by Discord id. */
  readonly names: ReadonlyMap<string, string>
  /** The Workshop preview as a data URI, or null to draw the stand-in art. */
  readonly preview: string | null
}

const check = () =>
  img(
    svgUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15"><circle cx="7.5" cy="7.5" r="7.5" fill="#111"/><path d="M4.2 7.8l2.2 2.2 4.4-4.6" fill="none" stroke="${C.gold}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    ),
    15,
    15
  )

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
            textShadow: OUTLINE
          },
          check(),
          kind
        ),
        box(
          { alignItems: "center", justifyContent: "center", backgroundColor: "#1f1f22", color: "#fff", fontWeight: 800, fontSize: 14, padding: "2px 12px", minWidth: 76 },
          formatTarget(medals[kind])
        )
      )
    )
  )

const ART = "linear-gradient(170deg, #3b7dd8 0%, #7fb6f2 45%, #f5c58a 70%, #e0874a 100%)"

const picture = (card: CardImage, height: number) => {
  const fill: Style = { position: "absolute", left: 0, top: 0, width: CARD_WIDTH, height }
  if (card.view.state === "invite")
    return box(
      {
        ...fill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: C.solid,
        backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 12px, rgba(255,255,255,0.06) 12px, rgba(255,255,255,0.06) 24px)",
        fontFamily: F.marquee,
        fontSize: 28,
        color: C.faint
      },
      "?"
    )
  return card.preview === null
    ? box({ ...fill, backgroundImage: ART })
    : img(card.preview, CARD_WIDTH, height, { ...fill, objectFit: "cover" })
}

interface Row {
  readonly rank: string
  readonly rankColour: string
  readonly hue: number
  readonly faded: boolean
  readonly name: string
  readonly note: string
  readonly score: string
  readonly medal: MedalKind | null
}

const rowsOf = (card: CardImage): ReadonlyArray<Row> => {
  const { view, names } = card
  const nameOf = (discordId: string) => names.get(discordId) ?? "Player"
  if (view.state === "invite") {
    const slots: Array<Row> = view.players.map((p, i) => ({
      rank: String(i + 1),
      rankColour: C.dim,
      hue: hueFor(p.steamId),
      faded: false,
      name: nameOf(p.discordId),
      note: i === 0 ? "opened the Invite" : "joined",
      score: "ready",
      medal: null
    }))
    const next = String(slots.length + 1)
    if (view.type === "public")
      slots.push({ rank: next, rankColour: C.faint, hue: 0, faded: true, name: "Open slot", note: "first to accept", score: "—", medal: null })
    if (view.type === "challenge" && view.target !== null)
      slots.push({
        rank: next,
        rankColour: C.faint,
        hue: hueFor(view.target.steamId),
        faded: true,
        name: nameOf(view.target.discordId),
        note: "challenged",
        score: "—",
        medal: null
      })
    return slots
  }
  const live = view.state === "live"
  const leader = view.standings[0]?.ticks ?? null
  return view.standings.map((s) => ({
    rank: s.rank === null ? "–" : String(s.rank),
    rankColour: placeColour(s.rank),
    hue: hueFor(s.player.steamId),
    faded: false,
    name: nameOf(s.player.discordId),
    note:
      s.ticks === null
        ? live
          ? "no time yet"
          : "did not finish"
        : s.rank === 1
          ? live
            ? "leads"
            : "wins"
          : leader === null
            ? ""
            : `+${formatSeconds(s.ticks - leader)} behind`,
    score: s.ticks === null ? (live ? "—" : "DNF") : formatTime(s.ticks),
    medal: s.medal
  }))
}

const COLUMNS = { rank: 34, marble: 24 } as const

const slab = (card: CardImage) => {
  const invite = card.view.state === "invite"
  return box(
    { flexDirection: "column", border: `1px solid ${C.line}`, borderRadius: 11, overflow: "hidden", backgroundColor: C.solid },
    box(
      { alignItems: "center", gap: 10, padding: "5px 12px", backgroundColor: "rgba(255,255,255,0.035)" },
      label(invite ? "Slot" : "Rank", { width: COLUMNS.rank }),
      box({ width: COLUMNS.marble }),
      label("Player", { flexGrow: 1 }),
      label(invite ? "" : "Time")
    ),
    ...rowsOf(card).map((r) =>
      box(
        { alignItems: "center", gap: 10, padding: "0 12px", minHeight: 44, borderTop: `1px solid ${C.line2}`, color: r.faded ? C.faint : C.text },
        box({ width: COLUMNS.rank, fontFamily: F.hud, fontWeight: 600, fontSize: 14, color: r.rankColour }, r.rank),
        marble(r.hue, 24, r.faded ? { opacity: 0.25 } : {}),
        box(
          { flexGrow: 1, flexDirection: "column", minWidth: 0 },
          box({ fontWeight: 600, fontSize: 14.5, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, r.name),
          r.note === "" ? null : box({ fontFamily: F.hud, fontWeight: 500, fontSize: 10.5, color: C.faint }, r.note)
        ),
        box({ alignItems: "center", gap: 8, fontFamily: F.hud, fontWeight: 600, fontSize: 16 }, r.score, r.medal === null ? null : medal(r.medal, 16))
      )
    )
  )
}

const stateChip = (view: CardView) =>
  view.state === "invite"
    ? chip(`Invite · ${view.minutes}:00`)
    : view.state === "live"
      ? chip("Live", { backgroundColor: C.accent, color: C.accentInk, border: "1px solid transparent", gap: 5 })
      : chip("Final", { color: C.gold, border: "1px solid rgba(255,212,71,0.4)" })

export const cardScene = (card: CardImage): El => {
  const { view } = card
  const height = view.state === "invite" ? 110 : 150
  const title = view.map === null || view.state === "invite" ? "Mystery map" : view.map.title
  const meta =
    view.map === null || view.state === "invite"
      ? `${TYPE_NAME[view.type]} · ${view.minutes} min · drawn at the start`
      : `by ${view.map.creator} · ${TYPE_NAME[view.type]} · ${view.minutes} min · WR ${formatTime(view.map.worldRecordTicks)}`
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
        backgroundImage: "linear-gradient(90deg, rgba(10,16,32,0.88), rgba(10,16,32,0.15) 65%)"
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
          justifyContent: "space-between"
        },
        logo(),
        box(
          { flexDirection: "column", alignItems: "flex-start" },
          box({ fontFamily: F.medal, fontWeight: 900, fontSize: 24, lineHeight: 1.1, textShadow: OUTLINE }, title),
          box({ fontFamily: F.hud, fontWeight: 500, fontSize: 11.5, color: C.dim, marginTop: 2 }, meta),
          box({ marginTop: 6 }, stateChip(view))
        )
      ),
      view.state === "invite" || view.map === null
        ? null
        : box({ position: "absolute", right: 10, top: 10, width: 200, flexDirection: "column" }, ladder(view.map.medals))
    ),
    box({ flexDirection: "column", padding: "2px 16px 14px" }, box({ marginTop: 10, flexDirection: "column" }, slab(card)))
  )
}

// ---------------------------------------------------------------- an Improvement row ("Gold Edge", Big Rank)

export const ROW_WIDTH = 420

export const improvementScene = (improvement: Improvement, name: string): El => {
  const lead = improvement.rank === 1
  const diff = improvement.previousTicks === null ? null : `-${formatSeconds(improvement.previousTicks - improvement.ticks)}`
  return backdrop(
    {
      width: ROW_WIDTH,
      flexDirection: "row",
      alignItems: "center",
      minHeight: 44,
      borderLeft: `4px solid ${lead ? C.gold : C.line}`,
      ...(lead ? { backgroundImage: "linear-gradient(90deg, rgba(255,212,71,0.16), transparent 70%)" } : {})
    },
    box(
      { width: 54, alignItems: "center", justifyContent: "center", fontFamily: F.hud, fontWeight: 700, fontSize: 22, color: lead ? C.gold : C.dim },
      `P${improvement.rank}`
    ),
    box(
      { flexGrow: 1, alignItems: "center", gap: 10, paddingRight: 12, minHeight: 44 },
      marble(hueFor(improvement.player.steamId), 24),
      box({ flexGrow: 1, fontWeight: 600, fontSize: 14.5, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, name),
      box(
        { alignItems: "center", gap: 8, fontFamily: F.hud, fontWeight: 600, fontSize: 16 },
        formatTime(improvement.ticks),
        diff === null ? null : box({ fontSize: 13, color: C.accent }, diff),
        improvement.medal === null ? null : medal(improvement.medal, 16)
      )
    )
  )
}

// ---------------------------------------------------------------- the Footer ("How It Works")

export const FOOTER_WIDTH = 520

const STEPS = [
  ["1", "Pick a mode", "Public 1v1, Challenge or Lobby"],
  ["2", "Map is drawn", "A Map no one here has finished"],
  ["3", "Fastest wins", "best time when the clock runs out"]
] as const

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
            padding: "7px 10px"
          },
          box({ fontFamily: F.hud, fontWeight: 600, fontSize: 18, color: C.accent }, n),
          box({ fontWeight: 700, fontSize: 13 }, title),
          box({ fontSize: 11, color: C.faint }, detail)
        )
      )
    ),
    box(
      { justifyContent: "center", marginTop: 10, fontFamily: F.hud, fontWeight: 500, fontSize: 11.5, color: C.faint },
      "Unofficial community tool · not made or supported by the Ballest developers"
    )
  )

// ---------------------------------------------------------------- the Link confirmation

export const LINK_WIDTH = 400

export const linkScene = (preview: ProfilePreview): El =>
  backdrop(
    { width: LINK_WIDTH, flexDirection: "row", alignItems: "center", gap: 12, padding: "14px 16px" },
    marble(hueFor(preview.steamId), 48),
    box(
      { flexDirection: "column", width: LINK_WIDTH - 32 - 48 - 12 },
      box({ fontFamily: F.hud, fontWeight: 700, fontSize: 17 }, preview.personaName),
      box(
        { fontFamily: F.hud, fontWeight: 500, fontSize: 11.5, color: C.faint, marginTop: 2 },
        `SteamID ${preview.steamId} · times on ${preview.campaignTracks} of ${preview.campaignTrackTotal} campaign Tracks`
      )
    )
  )
