// What each image looks like, as element trees for Satori (flexbox and CSS, no browser). The
// settled design is the prototype on branch claude/prototype-discord-bot-surfaces; check any
// change by eye with `pnpm render:samples`.
import { formatTime, MATCH_TYPE_NAME, type MedalKind, type Medals, type PbEvent, SCORE_TICKS_PER_SECOND } from "../domain.js"
import type { CardView, Improvement, ProfilePreview } from "../ports.js"
import { hueFor, MEDAL_BAR, marbleSvg, medalHeight, medalSvg, svgUri } from "./art.js"

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
const medal = (kind: MedalKind, size: number) => img(svgUri(medalSvg(kind, size)), size, medalHeight(size))

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
      ...style
    },
    lead,
    text
  )

// ---------------------------------------------------------------- formatting

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
  /** This Player holds the world record, set during the Match: a WR ribbon replaces the medal. */
  readonly worldRecord: boolean
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
      medal: null,
      worldRecord: false
    }))
    const next = String(slots.length + 1)
    if (view.type === "public")
      slots.push({ rank: next, rankColour: C.faint, hue: 0, faded: true, name: "Open slot", note: "first to accept", score: "—", medal: null, worldRecord: false })
    if (view.type === "challenge" && view.target !== null)
      slots.push({
        rank: next,
        rankColour: C.faint,
        hue: hueFor(view.target.steamId),
        faded: true,
        name: nameOf(view.target.discordId),
        note: "challenged",
        score: "—",
        medal: null,
        worldRecord: false
      })
    return slots
  }
  const live = view.state === "live"
  const leader = view.standings[0]?.ticks ?? null
  const personalBests = view.map?.personalBests ?? {}
  /** What a Player without a counted time is told, which differs for one who must beat their PB. */
  const untimed = (steamId: string) => {
    const pb = personalBests[steamId]
    if (pb === undefined) return live ? "no time yet" : "did not finish"
    return live ? `must beat their PB ${formatTime(pb)}` : `didn't beat their PB ${formatTime(pb)}`
  }
  return view.standings.map((s) => ({
    rank: s.rank === null ? "–" : String(s.rank),
    rankColour: placeColour(s.rank),
    hue: hueFor(s.player.steamId),
    faded: false,
    name: nameOf(s.player.discordId),
    note:
      s.ticks === null
        ? untimed(s.player.steamId)
        : s.rank === 1
          ? live
            ? "leads"
            : "wins"
          : leader === null
            ? ""
            : `+${formatSeconds(s.ticks - leader)} behind`,
    score: s.ticks === null ? (live ? "—" : "DNF") : formatTime(s.ticks),
    medal: s.medal,
    worldRecord: s.rank === 1 && s.ticks !== null && view.map !== null && s.ticks < view.map.worldRecordTicks
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
        box(
          { alignItems: "center", gap: 8, fontFamily: F.hud, fontWeight: 600, fontSize: 16 },
          r.score,
          r.worldRecord ? wrRibbon() : r.medal === null ? null : medal(r.medal, 16)
        )
      )
    )
  )
}

const stateChip = (view: CardView) =>
  view.state === "invite"
    ? chip(`Invite · ${view.minutes}:00`)
    : view.state === "live"
      ? chip(
          "Live",
          { backgroundColor: C.accent, color: C.accentInk, border: "1px solid transparent", gap: 5 },
          box({ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accentInk })
        )
      : chip("Final", { color: C.gold, border: "1px solid rgba(255,212,71,0.4)" })

export const cardScene = (card: CardImage): El => {
  const { view } = card
  const height = view.state === "invite" ? 110 : 150
  const title = view.map === null || view.state === "invite" ? "Map pending" : view.map.title
  const meta =
    view.map === null || view.state === "invite"
      ? `${MATCH_TYPE_NAME[view.type]} · ${view.minutes} min · drawn at the start`
      : `by ${view.map.creator} · ${MATCH_TYPE_NAME[view.type]} · ${view.minutes} min · WR ${formatTime(view.map.worldRecordTicks)}`
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
      textShadow: OUTLINE
    },
    "WR"
  )

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
      textShadow: OUTLINE
    },
    box({ width: 58, justifyContent: "center", fontSize: 24 }, "WR"),
    marble(hueFor(improvement.player.steamId), 28),
    box(
      { flexGrow: 1, flexDirection: "column", marginLeft: 10, minWidth: 0 },
      box({ fontSize: 15, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, name),
      box(
        { fontFamily: F.hud, fontWeight: 700, fontSize: 11, color: "#3a2a00", textShadow: "none" },
        `beat ${formatTime(beaten)} by ${formatSeconds(beaten - improvement.ticks)}`
      )
    ),
    box({ fontSize: 22, paddingRight: 16 }, formatTime(improvement.ticks))
  )

export const improvementScene = (improvement: Improvement, name: string): El => {
  if (improvement.beatWorldRecord !== null) return worldRecordScene(improvement, name, improvement.beatWorldRecord)
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
      { width: 58, alignItems: "center", justifyContent: "center", fontFamily: F.hud, fontWeight: 700, fontSize: 22, color: lead ? C.gold : C.dim },
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

// ---------------------------------------------------------------- the progression graph ("Staircase")

export const PROGRESSION_WIDTH = 520

export interface ProgressionImage {
  readonly view: CardView
  readonly history: ReadonlyArray<PbEvent>
  /** Each Player's display name, by Discord id. */
  readonly names: ReadonlyMap<string, string>
}

const MEDAL_COLOUR: Record<MedalKind, string> = { bronze: C.bronze, silver: C.silver, gold: C.gold, author: "#b36be8" }
const MEDAL_ORDER: ReadonlyArray<MedalKind> = ["bronze", "silver", "gold", "author"]

const starPath = (x: number, y: number, r: number) => {
  let d = ""
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    d += `${i ? "L" : "M"}${(x + rr * Math.cos(a)).toFixed(1)} ${(y + rr * Math.sin(a)).toFixed(1)}`
  }
  return `<path d="${d}Z" fill="${C.gold}" stroke="#111" stroke-width="1.2"/>`
}

/** A line of text placed like SVG text: `x` is where it starts, ends or centres, `y` its baseline. */
const textAt = (x: number, y: number, text: string, style: Style, anchor: "start" | "end" | "middle" = "start"): El => {
  const size = typeof style["fontSize"] === "number" ? style["fontSize"] : 10
  const place: Style =
    anchor === "start" ? { left: x } : anchor === "end" ? { right: PROGRESSION_WIDTH - x } : { left: x - 60, width: 120, justifyContent: "center" }
  return box({ position: "absolute", top: y - size * 0.82, lineHeight: 1, whiteSpace: "nowrap", ...style, ...place }, text)
}

const clockLabel = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`

/**
 * Every Player's PB over the Match clock as a step line, with the medals in range, the world
 * record as it stood (stepping down when beaten, each break a star), and any PB a Player
 * brought into the Match dotted in until they beat it.
 */
export const progressionScene = ({ view, history, names }: ProgressionImage): El => {
  const W = PROGRESSION_WIDTH, H = 470, L = 78, R = 150, T = 100, B = 58
  const map = view.map
  const secs = (ticks: number) => ticks / SCORE_TICKS_PER_SECOND
  const label10 = (ticks: number) => formatSeconds(ticks)
  const duration = view.minutes * 60
  const wr = map === null ? Infinity : secs(map.worldRecordTicks)
  const personalBests = map?.personalBests ?? {}
  const times = [...history.map((e) => secs(e.ticks)), ...Object.values(personalBests).map(secs)]
  const lo = Math.min(wr, ...times) - 0.35
  const hi = Math.min(Math.max(...times), (map?.medals.author ?? Math.max(...times)) + 1.5) + 0.3
  const x = (t: number) => L + (Math.min(t, duration) / duration) * (W - L - R)
  const y = (s: number) => T + ((hi - Math.min(s, hi)) / (hi - lo)) * (H - T - B)
  const nameOf = (steamId: string) => {
    const p = view.players.find((pl) => pl.steamId === steamId)
    return p === undefined ? "Player" : (names.get(p.discordId) ?? "Player")
  }
  const colourOf = (steamId: string) => `hsl(${hueFor(steamId)},78%,60%)`

  let lines = ""
  const overlays: Array<El> = []
  const tick = duration >= 1200 ? 300 : 120
  for (let t = 0; t <= duration; t += tick) {
    lines += `<line x1="${x(t)}" y1="${T}" x2="${x(t)}" y2="${H - B}" stroke="rgba(255,255,255,0.05)"/>`
    overlays.push(textAt(x(t), H - B + 16, clockLabel(t), { fontFamily: F.hud, fontSize: 10, color: C.faint }, "middle"))
  }

  const above: Array<string> = []
  if (map !== null)
    for (const kind of MEDAL_ORDER) {
      const v = map.medals[kind]
      if (v > hi) {
        above.push(`${kind} ${label10(v * SCORE_TICKS_PER_SECOND)}`)
        continue
      }
      lines += `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="${MEDAL_COLOUR[kind]}" stroke-opacity="0.55" stroke-width="1.2"/>`
      overlays.push(img(svgUri(medalSvg(kind, 11)), 11, medalHeight(11), { position: "absolute", left: L - 17, top: y(v) - 8 }))
      overlays.push(textAt(L - 22, y(v) + 3.5, label10(v * SCORE_TICKS_PER_SECOND), { fontFamily: F.hud, fontSize: 10, color: MEDAL_COLOUR[kind] }, "end"))
    }
  if (above.length > 0) overlays.push(textAt(L, T - 10, `▲ above the chart: ${above.join(" · ")}`, { fontFamily: F.hud, fontSize: 10, color: C.faint }))

  // The world record as it stood through the Match.
  const breaks: Array<PbEvent> = []
  let standing = wr
  for (const e of history)
    if (secs(e.ticks) < standing) {
      standing = secs(e.ticks)
      breaks.push(e)
    }
  if (map !== null) {
    let d = `M${x(0)} ${y(wr)}`
    for (const e of breaks) d += `H${x(e.at / 1000)}V${y(secs(e.ticks))}`
    lines += `<path d="${d}H${x(duration)}" fill="none" stroke="#fff" stroke-dasharray="5 4" stroke-width="1.3"/>`
    overlays.push(textAt(L - 22, y(wr) + 3.5, `WR ${label10(map.worldRecordTicks)}`, { fontFamily: F.hud, fontWeight: 700, fontSize: 10, color: "#fff" }, "end"))
  }

  for (const player of view.players) {
    const pts = history.filter((e) => e.steamId === player.steamId)
    const colour = colourOf(player.steamId)
    const pb = personalBests[player.steamId]
    const first = pts[0]
    if (pb !== undefined)
      lines += `<line x1="${x(0)}" y1="${y(secs(pb))}" x2="${x(first === undefined ? duration : first.at / 1000)}" y2="${y(secs(pb))}" stroke="${colour}" stroke-width="1.6" stroke-dasharray="2 3"/>`
    if (first === undefined) continue
    let d = `M${x(first.at / 1000)} ${y(secs(first.ticks))}`
    for (const e of pts.slice(1)) d += `H${x(e.at / 1000)}V${y(secs(e.ticks))}`
    lines += `<path d="${d}H${x(duration)}" fill="none" stroke="${colour}" stroke-width="2.3" stroke-linejoin="round"/>`
    for (const e of pts) lines += `<circle cx="${x(e.at / 1000)}" cy="${y(secs(e.ticks))}" r="2.8" fill="${colour}" stroke="${C.bg}" stroke-width="1"/>`
  }
  for (const e of breaks)
    lines += `<circle cx="${x(e.at / 1000)}" cy="${y(secs(e.ticks))}" r="15" fill="${C.gold}" fill-opacity="0.18"/>${starPath(x(e.at / 1000), y(secs(e.ticks)), 10)}`

  const chart = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${lines}</svg>`
  const holder = breaks.at(-1)?.steamId
  const timed = view.standings.filter((s) => s.ticks !== null)
  const untimed = view.standings.filter((s) => s.ticks === null)

  return backdrop(
    { width: W, height: H, position: "relative" },
    img(svgUri(chart), W, H, { position: "absolute", left: 0, top: 0 }),
    ...overlays,
    box(
      { position: "absolute", left: 16, top: 12, width: W - 32, flexDirection: "column" },
      box({ justifyContent: "space-between", alignItems: "center" }, logo(), label("Progression")),
      box({ fontFamily: F.medal, fontWeight: 900, fontSize: 20, textShadow: OUTLINE, marginTop: 8 }, map?.title ?? "Match"),
      box(
        { fontFamily: F.hud, fontWeight: 500, fontSize: 10.5, color: C.dim },
        `${view.minutes}-minute ${MATCH_TYPE_NAME[view.type]} · WR at the start ${map === null ? "none" : label10(map.worldRecordTicks)} · every PB as it happened`
      )
    ),
    box(
      { position: "absolute", left: W - R + 12, top: T - 4, width: R - 24, flexDirection: "column", gap: 10 },
      ...timed.map((s) =>
        box(
          { gap: 8, alignItems: "flex-start" },
          marble(hueFor(s.player.steamId), 16, { marginTop: 1 }),
          box(
            { flexDirection: "column", flexShrink: 1, minWidth: 0 },
            box({ fontWeight: 600, fontSize: 11 }, nameOf(s.player.steamId)),
            box(
              { fontFamily: F.hud, fontWeight: 600, fontSize: 10, color: s.player.steamId === holder ? C.gold : C.dim },
              `${s.ticks === null ? "" : formatTime(s.ticks)}${s.player.steamId === holder ? "  ★ new WR" : ""}`
            )
          )
        )
      )
    ),
    untimed.length === 0
      ? null
      : textAt(L, H - 12, `No time: ${untimed.map((s) => nameOf(s.player.steamId)).join(", ")}`, { fontFamily: F.hud, fontSize: 10, color: C.faint })
  )
}
