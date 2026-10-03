// The page's markup: every screen as a string of HTML, from the API's views and nothing else.
// Ported from the settled prototype (branch claude/prototype-activity-surfaces). What a Match
// says is shared with the Card: its rows and words come from present.ts, its PBs from
// `progress`, its marbles and Medals from render/art.ts, and what the viewer may press from the
// server. Buttons carry `data-act="<verb>[:<arg>]"`, which app.ts acts on; countdowns are
// `data-until` spans it fills.
import {
  DURATIONS,
  formatTime,
  MATCH_TYPE_NAME,
  type MatchType,
  type MedalKind,
  medalFor,
  type Minutes,
  progress,
  SCORE_TICKS_PER_SECOND,
} from "../../domain.js";
import {
  boardRows,
  formatGap,
  mapTitle,
  type HowtoPart,
  matchDetails,
  matchName,
  STEAM_LINK_HOWTO,
} from "../../present.js";
import { hueFor, marbleSvg, medalSvg } from "../../render/art.js";
import type { Challengeable, MatchView } from "../api.js";

/** Who is looking: their Discord id, and their Link if they have one. */
export interface Viewer {
  readonly discordId: string;
  readonly link: { readonly steamId: string; readonly personaName: string } | null;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const MEDALS: ReadonlyArray<MedalKind> = ["bronze", "silver", "gold", "author"];
/** The graph's and the Medal track's line colours; author is the design system's purple. */
const MEDAL_LINE: Record<MedalKind, string> = {
  bronze: "#e0a650",
  silver: "#c9c9c9",
  gold: "#ffe600",
  author: "#b36be8",
};
const TYPE = MATCH_TYPE_NAME;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const secs = (ticks: number) => ticks / SCORE_TICKS_PER_SECOND;
const clockText = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const rankClass = (r: number | null) => (r === 1 ? "r1" : r === 2 ? "r2" : r === 3 ? "r3" : "rn");

/** A countdown to `at` on the server's clock; app.ts fills it in every tick. */
export const until = (at: number | null) => `<span data-until="${at ?? 0}"></span>`;

// ---------------------------------------------------------------- art

/** Gradient ids have to be unique in the page; reset before each full draw so equal pages compare equal. */
let uid = 0;
export const resetIds = () => {
  uid = 0;
};

/** The site's marble, coloured by SteamID so a Player has one colour everywhere; grey for an empty seat. */
export const marble = (
  steamId: string | null,
  size = 24,
  hue = steamId === null ? 220 : hueFor(steamId),
) =>
  `<span class="marble" style="width:${size}px;height:${size}px">${marbleSvg(hue, size, `m${uid++}`)}</span>`;

const medal = (kind: MedalKind | null, w = 16) =>
  kind === null
    ? ""
    : `<span role="img" aria-label="${kind} Medal" style="display:inline-flex;flex:none">${medalSvg(kind, w, `d${uid++}`)}</span>`;

export const logo = () =>
  `<span class="logo"><span class="rack">${marble(null, 18, 212)}${marble(null, 18, 332)}${marble(null, 18, 96)}</span><span class="wordmark">Multi<b>balls</b></span></span>`;

/** Matches whose preview didn't load: they keep the stand-in art rather than asking again at every redraw. */
export const noPreview = new Set<string>();

/** The Map's Workshop preview over the stand-in art, or the sealed "?" before the draw. */
const art = (m: MatchView) =>
  m.map === null
    ? `<div class="sealed">?</div>`
    : `<div class="art">${noPreview.has(m.matchId) ? "" : `<img src="/previews/${esc(m.matchId)}" alt="" data-preview="${esc(m.matchId)}">`}</div>`;

// ---------------------------------------------------------------- a Match, derived

const nameOf = (m: MatchView) => (discordId: string) => m.names[discordId] ?? "Player";
const nameBySteam = (m: MatchView, steamId: string) => {
  const p = m.players.find((pl) => pl.steamId === steamId);
  return esc(p === undefined ? "Player" : nameOf(m)(p.discordId));
};

export const titleOf = (m: MatchView) => esc(matchName(m, nameOf(m)));

const chipFor = (m: MatchView) =>
  m.state === "invite"
    ? `<span class="chip">Invite · ${until(m.expiresAt)}</span>`
    : m.state === "live"
      ? `<span class="chip live">Live · ${until(m.endsAt)}</span>`
      : `<span class="chip final">Final</span>`;

const stackOf = (m: MatchView, size = 22) =>
  `<span class="stack">${m.players.map((p) => marble(p.steamId, size)).join("")}</span>`;

/** When the Match started, on the server's clock. */
export const startedAt = (m: MatchView) => (m.endsAt ?? 0) - m.minutes * 60_000;

/** One of the Match's Players (who may have left it since). */
export const isRacer = (m: MatchView, discordId: string) =>
  m.players.some((p) => p.discordId === discordId);

// ---------------------------------------------------------------- the Match's parts

/** The Board Slab: the Card's rows, as HTML. */
const slab = (m: MatchView, viewer: Viewer) => {
  const rows = boardRows(m, nameOf(m)).map((r) => {
    const score =
      r.score === "ready"
        ? `<span class="note">ready</span>`
        : r.score === "—"
          ? `<span class="rn">—</span>`
          : r.score === "DNF"
            ? `<span class="dnf">DNF</span>`
            : `${r.score}${r.worldRecord ? `<span class="wr">WR</span>` : medal(r.medal)}`;
    const me = r.discordId === viewer.discordId && !r.faded;
    return `<div class="row ${me ? "me" : ""} ${r.faded ? "open" : ""}"><span class="rk ${r.faded ? "rn" : rankClass(r.place)}">${r.rank}</span>${marble(r.steamId, 26)}<div style="min-width:0"><div class="nm">${esc(r.name)}</div>${r.note === "" ? "" : `<div class="note">${r.note}</div>`}</div><div class="sc">${score}</div></div>`;
  });
  return `<div class="panel slab">${rows.join("")}</div>`;
};

/** Your place, your gap to P1, and your gap to the next Medal. */
const yourLine = (m: MatchView, viewer: Viewer) => {
  const me = m.standings.find((s) => s.player.discordId === viewer.discordId);
  const leader = m.standings[0];
  if (m.map === null || me?.ticks == null || me.rank === null || leader === undefined) return "";
  const medals = m.map.medals;
  const t = me.ticks;
  const next = MEDALS.find((k) => secs(t) > medals[k]);
  const place =
    me.rank === 1
      ? "<b>leading</b>"
      : `<b>+${formatGap(t - (leader.ticks ?? t))}</b> to ${esc(nameOf(m)(leader.player.discordId))}`;
  const medalGap =
    next === undefined ? "every Medal" : `<b>${(secs(t) - medals[next]).toFixed(3)}</b> to ${next}`;
  return `<div class="yourline">You're <b class="${rankClass(me.rank)}">P${me.rank}</b> · ${place} · ${medalGap}</div>`;
};

/** Everyone's best time on a bar of the four Medals, with the world record marked. */
const track = (m: MatchView, viewer: Viewer) => {
  if (m.map === null) return "";
  const medals = m.map.medals;
  const lo = secs(m.map.worldRecordTicks) * 0.95;
  const hi = medals.bronze * 1.05;
  const pct = (s: number) => Math.max(0, Math.min(100, ((hi - s) / (hi - lo)) * 100));
  const x = (s: number) => `${pct(s).toFixed(2)}%`;
  // Each band runs from its Medal's time to the next one's, so a pin sits in the colour it earned.
  const edges = [0, ...MEDALS.map((k) => pct(medals[k])), 100];
  const fills = ["#1f1f22", ...MEDALS.map((k) => `var(--mg-${k})`)];
  const bands = fills
    .map(
      (fill, i) =>
        `<i style="flex:0 0 ${((edges[i + 1] ?? 100) - (edges[i] ?? 0)).toFixed(2)}%;background:${fill}"></i>`,
    )
    .join("");
  const pins = m.standings
    .flatMap((s) => {
      if (s.ticks === null) return [];
      const me = s.player.discordId === viewer.discordId;
      return [
        `<div class="pin" style="left:${x(secs(s.ticks))};z-index:${me ? 3 : 1}" title="${esc(nameOf(m)(s.player.discordId))}">${marble(s.player.steamId, me ? 28 : 22)}</div>`,
      ];
    })
    .join("");
  const ticks =
    MEDALS.map(
      (k) =>
        `<span class="tl" style="left:${x(medals[k])}">${cap(k)[0]} ${medals[k].toFixed(1)}</span>`,
    ).join("") +
    `<span class="tl" style="left:${x(secs(m.map.worldRecordTicks))};color:var(--gold)">WR</span>`;
  return `<div class="track" aria-label="Medal track"><div class="bar">${bands}</div>${pins}${ticks}</div>`;
};

const star = (cx: number, cy: number, r1: number, r2: number) => {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? r2 : r1;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
};

/**
 * The progression graph: every PB over the Match clock, log-scaled, with the Medal and WR lines,
 * PBs brought into the Match dotted until beaten, and a star on each world-record break.
 */
const graph = (m: MatchView, now: number, wide: boolean) => {
  if (m.map === null) return "";
  const map = m.map;
  const W = wide ? 900 : 520;
  const H = wide ? 280 : 300;
  const L = 52,
    R = 96,
    T = 14,
    B = 30;
  const dur = m.minutes * 60;
  const at = m.state === "finished" ? dur : Math.max(0, Math.min(dur, (now - startedAt(m)) / 1000));
  const wr = secs(map.worldRecordTicks);
  const pbs = map.personalBests;
  const all = [...m.history.map((e) => secs(e.ticks)), ...Object.values(pbs).map(secs)];
  const lo = Math.min(wr, ...all) * 0.97;
  const hi = Math.max(map.medals.bronze, ...all) * 1.04;
  const x = (s: number) => L + (s / dur) * (W - L - R);
  const y = (s: number) =>
    T + ((Math.log(hi) - Math.log(s)) / (Math.log(hi) - Math.log(lo))) * (H - T - B);
  const text = (tx: number, ty: number, fill: string, body: string, anchor = "end", size = 9.5) =>
    `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="${fill}" font-family="Chakra Petch" font-size="${size}" text-anchor="${anchor}">${body}</text>`;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Progression graph">`;
  const step = dur >= 1200 ? 300 : dur >= 600 ? 120 : 60;
  for (let s = 0; s <= dur; s += step)
    svg += `<line x1="${x(s)}" x2="${x(s)}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.05)"/>${text(x(s), H - 10, "#63719a", clockText(s), "middle", 10)}`;
  for (const k of MEDALS) {
    const v = map.medals[k];
    if (v > hi || v < lo) continue;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${MEDAL_LINE[k]}" stroke-opacity=".55" stroke-dasharray="2 4"/>${text(L - 6, y(v) + 3, MEDAL_LINE[k], v.toFixed(1))}`;
  }
  svg += `<line x1="${L}" x2="${W - R}" y1="${y(wr)}" y2="${y(wr)}" stroke="#fff" stroke-opacity=".6" stroke-dasharray="4 3"/>${text(L - 6, y(wr) + 3, "#fff", "WR")}`;
  if (m.state === "live")
    svg += `<line x1="${x(at)}" x2="${x(at)}" y1="${T}" y2="${H - B}" stroke="#8be03c" stroke-opacity=".5"/>`;
  for (const p of m.players) {
    const pts = m.history
      .filter((e) => e.steamId === p.steamId)
      .map((e) => [e.at / 1000, secs(e.ticks)] as const);
    const colour = `hsl(${hueFor(p.steamId)} 78% 60%)`;
    const pb = pbs[p.steamId];
    const first = pts[0];
    if (pb !== undefined && (first === undefined || first[1] > secs(pb)))
      svg += `<line x1="${x(0)}" x2="${x(first === undefined ? at : first[0])}" y1="${y(secs(pb))}" y2="${y(secs(pb))}" stroke="${colour}" stroke-width="2" stroke-dasharray="2 3"/>`;
    if (first === undefined) continue;
    let d = `M${x(first[0]).toFixed(1)} ${y(first[1]).toFixed(1)}`;
    for (const [a, t] of pts.slice(1)) d += ` H${x(a).toFixed(1)} V${y(t).toFixed(1)}`;
    d += ` H${x(at).toFixed(1)}`;
    svg += `<path d="${d}" fill="none" stroke="${colour}" stroke-width="2.3"/>`;
    svg += pts
      .map(
        ([a, t]) =>
          `<circle cx="${x(a).toFixed(1)}" cy="${y(t).toFixed(1)}" r="2.8" fill="${colour}"/>`,
      )
      .join("");
    const last = pts[pts.length - 1] ?? first;
    svg += `<text x="${(x(at) + 8).toFixed(1)}" y="${(y(last[1]) + 4).toFixed(1)}" fill="${colour}" font-family="Archivo" font-weight="600" font-size="11">${esc(nameOf(m)(p.discordId))}</text>`;
  }
  for (const e of progress(map, m.history).filter((e) => e.beatWorldRecord !== null)) {
    const cx = x(e.at / 1000),
      cy = y(secs(e.ticks));
    svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="10" fill="#ffd447" fill-opacity=".18"/><path d="${star(cx, cy, 7, 3)}" fill="#ffd447" stroke="#111"/>`;
  }
  return `<div class="panel graph"><div class="panel-h"><span class="label">Progression</span><span class="note">${m.state === "live" ? "live" : "final"}</span></div><div style="padding:6px 8px">${svg}</svg></div></div>`;
};

/** The Improvements feed: every PB as the Match Thread posted it, newest first, stamped with the Match clock. */
const feed = (m: MatchView) => {
  const map = m.map;
  const ev = map === null ? [] : [...progress(map, m.history)].reverse();
  const rows = ev
    .map((e) => {
      const at = clockText(e.at / 1000);
      if (e.beatWorldRecord !== null)
        return `<div class="imp wrk"><span class="pk">WR</span>${marble(e.steamId, 26)}<div style="min-width:0"><div class="nm">${nameBySteam(m, e.steamId)}</div><div class="sub">beat ${formatTime(e.beatWorldRecord)} by ${formatGap(e.beatWorldRecord - e.ticks)} · at ${at}</div></div><span class="tm">${formatTime(e.ticks)}</span></div>`;
      const kind = map === null ? null : medalFor(e.ticks, map.medals);
      return `<div class="imp ${e.rank === 1 ? "gold" : ""}"><span class="pk">P${e.rank}</span>${marble(e.steamId, 24)}<div style="min-width:0"><div class="nm">${nameBySteam(m, e.steamId)}</div><div class="note">at <span class="stamp">${at}</span>${e.previousTicks === null ? " · first time" : ""}</div></div><span class="tm">${formatTime(e.ticks)}${e.previousTicks === null ? "" : `<span class="diff" style="font-size:12.5px">-${formatGap(e.previousTicks - e.ticks)}</span>`}${medal(kind)}</span></div>`;
    })
    .join("");
  return `<div class="panel"><div class="panel-h"><span class="label">Improvements · ${ev.length}</span></div><div class="feed scroll">${rows || `<div style="padding:14px" class="note">No times yet.</div>`}</div></div>`;
};

// ---------------------------------------------------------------- buttons

const btn = (act: string, label: string, cls = "", disabled = false) =>
  `<button class="btn ${cls}" data-act="${esc(act)}"${disabled ? " disabled" : ""}>${label}</button>`;

/** What the viewer may press on a Match they aren't in, on its tile (`tile`) or in its Match view. */
const offer = (m: MatchView, tile: boolean, pb: number | null | undefined) => {
  if (m.state === "finished") return "";
  const can = (a: string) => m.actions.some((x) => x === a);
  let out = "";
  if (can("accept")) out += btn(`accept:${m.matchId}`, "Accept", "go sm");
  if (can("decline"))
    out +=
      btn(`decline:${m.matchId}`, "Decline", "warn sm") +
      `<span class="why">${until(m.expiresAt)} to answer</span>`;
  if (can("join"))
    out += btn(
      `join:${m.matchId}`,
      m.state === "live" ? "Join late" : `Join (${m.players.length})`,
      "go sm",
    );
  if (tile && (m.state === "live" || out === ""))
    out += btn(`watch:${m.matchId}`, "Watch", `sm ${out === "" ? "" : "ghost"}`);
  if (!tile && can("join") && m.state === "live" && pb != null)
    out += `<span class="why">Your PB ${formatTime(pb)} is the time to beat</span>`;
  return out;
};

/** Your own live Match's buttons, and a Result's. */
const ownButtons = (m: MatchView) => {
  if (m.state !== "live") return resultButtons(m);
  return (
    (m.map === null ? "" : btn(`workshop:${m.map.pfid}`, "Open Map in Workshop", "sm")) +
    (m.links?.thread == null ? "" : btn("thread", "Match Thread", "sm")) +
    (m.actions.includes("leave") ? btn(`leave:${m.matchId}`, "Leave", "warn sm") : "")
  );
};

const resultButtons = (m: MatchView) =>
  (m.links === null ? "" : btn("channel", "See it in the channel", "sm")) +
  btn("back", "Back to Matches", "go sm");

// ---------------------------------------------------------------- the header

const meLink = (viewer: Viewer) =>
  viewer.link === null
    ? `<span class="me-link">Not linked · <button data-act="link"><u>Link Steam</u></button></span>`
    : `<span class="me-link">${marble(viewer.link.steamId, 18)}Linked as <u>${esc(viewer.link.personaName)}</u> · <button data-act="link"><u>Change</u></button></span>`;

const topBar = (viewer: Viewer) => `<div class="top">${logo()}${meLink(viewer)}</div>`;

// ---------------------------------------------------------------- screens

export const signingIn = () =>
  `<div class="vE"><div class="emptyb" style="border:0">${logo()}<span class="note">Signing in…</span></div></div>`;

export const wrongServer = () =>
  `<div class="vE"><div class="emptyb">${logo()}<div class="mt" style="font-size:22px">Multiballs only runs in the Ballest server</div><div class="note">Open it from a channel there.</div></div></div>`;

/** The demo's stand-in for Discord's sign-in. */
export const demoSignIn = (users: ReadonlyArray<{ readonly id: string; readonly name: string }>) =>
  `<div class="vE"><div class="emptyb demo">${logo()}<span class="label">Demo: sign in as</span><div class="row-btns">${users.map((u) => btn(`dev:${u.id}`, esc(u.name))).join("")}</div></div></div>`;

export const failed = (why: string) =>
  `<div class="vE"><div class="emptyb">${logo()}<div class="err">${esc(why)}</div></div></div>`;

// The Gallery

export interface Draft {
  readonly type: MatchType;
  readonly minutes: Minutes;
  readonly target: string | null;
}

const TYPES: ReadonlyArray<readonly [MatchType, string]> = [
  ["public", "First to accept plays you"],
  ["challenge", "Pick who you play"],
  ["lobby", "Anyone can join; you start it"],
];

/** The Challenge picker: linked Players, searchable by Discord or Steam name, busy ones greyed out. */
const whoPicker = (draft: Draft, players: ReadonlyArray<Challengeable> | null, search: string) => {
  if (draft.type !== "challenge") return "";
  const q = search.trim().toLowerCase();
  const shown = (players ?? []).filter(
    (p) => q === "" || p.name.toLowerCase().includes(q) || p.steamName.toLowerCase().includes(q),
  );
  const list =
    players === null
      ? `<span class="note">Loading Players…</span>`
      : shown
          .map(
            (p) =>
              `<button class="wp ${draft.target === p.discordId ? "on" : ""}" data-act="who:${esc(p.discordId)}"${p.busy ? " disabled" : ""}>${marble(p.steamId, 22)}<span style="display:grid;line-height:1.15;text-align:left"><span>${esc(p.name)}</span><span class="note">${esc(p.steamName)}${p.busy ? " · in a Match" : ""}</span></span></button>`,
          )
          .join("") || `<span class="note">Nobody by that name.</span>`;
  return `<div class="who"><input id="who" value="${esc(search)}" placeholder="Search by Discord or Steam name" aria-label="Search Players" autocomplete="off"><div class="wl">${list}</div>
    <details class="hint"><summary>Can't find someone?</summary>They need to link Steam in Multiballs first. Search by Discord or Steam name.</details></div>`;
};

const composer = (
  draft: Draft,
  players: ReadonlyArray<Challengeable> | null,
  search: string,
  busy: boolean,
) =>
  `<div class="gt composing"><div class="form"><div style="display:flex;justify-content:space-between;align-items:center"><span class="label">New Match</span><button class="link" data-act="close-new">Close</button></div>
    <div class="types">${TYPES.map(([k, d]) => `<button class="type ${draft.type === k ? "on" : ""}" data-act="type:${k}"><b>${TYPE[k]}</b><span>${d}</span></button>`).join("")}</div>
    ${whoPicker(draft, players, search)}
    <div class="seg">${DURATIONS.map((d) => `<button class="${draft.minutes === d ? "on" : ""}" data-act="min:${d}">${d} min</button>`).join("")}</div>
    <div>${btn("open", "Open Invite", "go", busy || (draft.type === "challenge" && draft.target === null))}</div></div></div>`;

/** An Invite's seats: its Players, then the seats left (a Lobby always shows one spare). */
const seats = (m: MatchView, viewer: Viewer, size = 30) => {
  const filled = m.players.map((p) => `<span class="seat">${marble(p.steamId, size)}</span>`);
  if (m.type === "challenge" && m.target !== null)
    filled.push(
      `<span class="seat ${m.target.discordId === viewer.discordId ? "you" : ""}" style="opacity:.55">${marble(m.target.steamId, size)}</span>`,
    );
  const empty = m.type === "lobby" ? 1 : m.type === "public" ? 2 - m.players.length : 0;
  for (let i = 0; i < empty; i++)
    filled.push(`<span class="seat empty" style="width:${size}px;height:${size}px">+</span>`);
  return `<span class="seats">${filled.join("")}</span>`;
};

const top3 = (m: MatchView) =>
  `<div class="t3s">${m.standings
    .slice(0, 3)
    .map(
      (s) =>
        `<div class="t3"><span class="${rankClass(s.rank)}">${s.rank ?? "–"}</span>${marble(s.player.steamId, 18)}<span class="n">${esc(nameOf(m)(s.player.discordId))}</span><span>${s.ticks === null ? "—" : formatTime(s.ticks)}</span></div>`,
    )
    .join("")}</div>`;

const tile = (m: MatchView, viewer: Viewer) => {
  const forYou = m.actions.includes("decline");
  return `<div class="gt ${forYou ? "you" : ""}">${art(m)}<div class="ov">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:start">${chipFor(m)}${forYou ? `<span class="chip you">Challenges you</span>` : ""}</div>
    <div style="display:grid;gap:8px"><div><div class="mt">${m.map === null ? titleOf(m) : esc(m.map.title)}</div><div class="note" style="color:#c9d3f0">${m.map === null ? esc(matchDetails(m)) : `${titleOf(m)} · ${m.minutes} min`}</div></div>
    ${m.state === "live" ? top3(m) : seats(m, viewer)}<div class="row-btns">${offer(m, true, undefined)}</div></div></div></div>`;
};

/** Open Invites soonest to expire first, then live Matches, most recently started first. */
const ordered = (ms: ReadonlyArray<MatchView>) => [
  ...ms.filter((m) => m.state === "invite").sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0)),
  ...ms.filter((m) => m.state === "live").sort((a, b) => startedAt(b) - startedAt(a)),
];

export const gallery = (
  viewer: Viewer,
  matches: ReadonlyArray<MatchView>,
  compose: {
    readonly draft: Draft;
    readonly players: ReadonlyArray<Challengeable> | null;
    readonly search: string;
    readonly busy: boolean;
  } | null,
) => {
  if (matches.length === 0 && compose === null)
    return `<div class="vE">${topBar(viewer)}<div class="emptyb"><div class="mt" style="font-size:24px">No active Matches</div>${btn("new", "New Match", "go big")}</div></div>`;
  const first =
    compose === null
      ? `<button class="gt new" data-act="new"><span class="mt" style="font-size:22px">+ New Match</span></button>`
      : composer(compose.draft, compose.players, compose.search, compose.busy);
  return `<div class="vE">${topBar(viewer)}<div class="gal">${first}${ordered(matches)
    .map((m) => tile(m, viewer))
    .join("")}</div></div>`;
};

// The Card Stack: your Invite before the start

const sealedHero = (m: MatchView, line: string, chips: string) =>
  `<div class="hero"><div class="sealed">?</div><div class="scrim"></div><div class="copy"><div class="mt">${line}</div><div class="hud" style="font-size:12px;color:var(--dim)">${esc(matchDetails(m))}</div><div class="row-btns">${chips}<span class="chip you">Your Match</span></div></div></div>`;

const cardStack = (m: MatchView, viewer: Viewer, hero: string, dock: string, extra = "") =>
  `<div class="vA"><div class="top">${logo()}<span class="note">${titleOf(m)}</span></div>${hero}${slab(m, viewer)}${extra}<div class="dock">${dock}</div></div>`;

/** Your open Invite: hosting a Lobby, waiting in someone else's, or waiting on your 1v1. */
export const myInvite = (m: MatchView, viewer: Viewer, busy: boolean) => {
  const hero = sealedHero(m, esc(mapTitle(m)), chipFor(m));
  const id = m.matchId;
  const pinged =
    m.type === "lobby"
      ? `<div class="panel" style="padding:12px 14px"><span class="note">Players get pinged in the Match Thread when it starts.</span></div>`
      : "";
  if (m.actions.includes("start"))
    return cardStack(
      m,
      viewer,
      hero,
      `<span class="note">Invite expires in ${until(m.expiresAt)}</span><span class="row-btns">${btn(`cancel:${id}`, "Cancel", "ghost", busy)}${btn(`start:${id}`, `Start · ${m.players.length} Player${m.players.length === 1 ? "" : "s"}`, "go", busy)}</span>`,
      pinged,
    );
  if (m.actions.includes("leave"))
    return cardStack(
      m,
      viewer,
      hero,
      `<span class="note">Waiting for ${esc(nameOf(m)(m.creator.discordId))} to start</span><span>${btn(`leave:${id}`, "Leave", "ghost", busy)}</span>`,
      pinged,
    );
  const other =
    m.type === "challenge" && m.target !== null
      ? esc(nameOf(m)(m.target.discordId))
      : "someone to accept";
  return cardStack(
    m,
    viewer,
    hero,
    `<span class="note">Waiting for ${other} · ${until(m.expiresAt)} left</span><span>${btn(`cancel:${id}`, "Cancel", "ghost", busy)}</span>`,
  );
};

/** Start or Accept pressed: the server is picking a Map. */
export const picking = (m: MatchView, viewer: Viewer) =>
  cardStack(
    m,
    viewer,
    sealedHero(m, `Picking a Map…<span class="dots"></span>`, `<span class="chip">Starting</span>`),
    `<span class="note">Up to 20 seconds</span><span>${btn("", "Starting…", "", true)}</span>`,
  );

/** No Map fitted, so the Invite was cancelled. */
export const noMap = (m: MatchView, viewer: Viewer) =>
  cardStack(
    m,
    viewer,
    sealedHero(m, "No Map fits", `<span class="chip">Cancelled</span>`),
    `<span class="note">No Map fits a ${m.minutes}-minute Match, so the ${TYPE[m.type]} was cancelled.</span><span>${btn("back", "Back to Matches", "go")}</span>`,
  );

// The Match view: watching, racing and the Result, straight down

export interface MatchScreen {
  readonly m: MatchView;
  readonly viewer: Viewer;
  /** It's the viewer's own Match: no browsing, and their own buttons. */
  readonly locked: boolean;
  /** The server's clock now. */
  readonly now: number;
  readonly wide: boolean;
  /** The viewer's PB on the Map, for a late join; undefined until read. */
  readonly pb: number | null | undefined;
  /** The Map was just drawn: slide the art in. */
  readonly reveal: boolean;
}

export const matchView = ({ m, viewer, locked, now, wide, pb, reveal }: MatchScreen) => {
  const top = locked
    ? `<div class="top">${logo()}<span></span></div>`
    : `<div class="top"><button class="link" data-act="back">← All Matches</button>${meLink(viewer)}</div>`;
  const buttons =
    m.state === "finished" ? resultButtons(m) : locked ? ownButtons(m) : offer(m, false, pb);
  const hero = `<div class="hero">${art(m)}<div class="ov"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="row-btns">${chipFor(m)}${locked ? `<span class="chip you">Your Match</span>` : ""}</span>${stackOf(m, 26)}</div>
    <div style="display:grid;gap:8px"><div class="mt">${esc(mapTitle(m))}</div><div class="note" style="color:#c9d3f0">${titleOf(m)} · ${esc(matchDetails(m))}</div><div class="row-btns">${buttons}</div></div></div></div>`;
  const racing = locked && m.state !== "invite" ? yourLine(m, viewer) : "";
  const rest =
    m.map === null
      ? slab(m, viewer)
      : `${track(m, viewer)}${slab(m, viewer)}${graph(m, now, wide)}${feed(m)}`;
  return `<div class="vE ${reveal ? "reveal-in" : ""}">${top}${hero}${racing}${rest}</div>`;
};

/** The first moments of your live Match: Go!, when it ends (on this device's clock), and the Workshop button. */
export const goBar = (m: MatchView, offset: number) => {
  const ends = new Date((m.endsAt ?? 0) - offset).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `<div class="gobar"><b>Go!</b> Ends at ${ends} ${m.map === null ? "" : btn(`workshop:${m.map.pfid}`, "Open Map in Workshop", "sm")}</div>`;
};

// Picture-in-picture: Discord shrinks the Activity to a small window when you leave the call's view.
// Nothing in it is pressed (a click brings the full page back), so it only shows where things stand.

/** The Match on screen as its top three, each with their time and gap to P1; your row replaces third if you're lower. */
const pipMatch = (m: MatchView, viewer: Viewer) => {
  const top = m.standings.slice(0, 3);
  const me = m.standings.find((s) => s.player.discordId === viewer.discordId);
  const shown = me === undefined || top.includes(me) ? top : [...top.slice(0, 2), me];
  const lead = m.standings[0]?.ticks ?? null;
  const rows = shown
    .map((s) => {
      const gap =
        s.ticks === null || lead === null || s.ticks === lead
          ? ""
          : `+${formatGap(s.ticks - lead)}`;
      return `<div class="pr ${s.player.discordId === viewer.discordId ? "me" : ""}"><span class="${rankClass(s.rank)}">${s.rank ?? "–"}</span>${marble(s.player.steamId, 15)}<span class="n">${esc(nameOf(m)(s.player.discordId))}</span><span>${s.ticks === null ? "—" : formatTime(s.ticks)}</span><span class="gap">${gap}</span></div>`;
    })
    .join("");
  return `<div class="pip"><div class="pip-h"><span class="mt">${esc(mapTitle(m))}</span>${chipFor(m)}</div><div class="pip-rows">${rows}</div></div>`;
};

/** The small window: the Match on screen, else a Challenge that names you, else how many Matches are on. */
export const pip = (viewer: Viewer, focus: MatchView | null, matches: ReadonlyArray<MatchView>) => {
  if (focus !== null) return pipMatch(focus, viewer);
  const challenge = matches.find((m) => m.actions.includes("decline"));
  if (challenge !== undefined)
    return `<div class="pip">${logo()}<div class="pip-box you">${marble(challenge.creator.steamId, 22)}<div><div class="mt">${esc(nameOf(challenge)(challenge.creator.discordId))} challenges you</div><div class="note">${esc(matchDetails(challenge))} · ${until(challenge.expiresAt)} to answer</div></div></div></div>`;
  const n = matches.length;
  return `<div class="pip">${logo()}<div class="pip-box"><div class="mt">${n === 0 ? "No active Matches" : `${n} active Match${n === 1 ? "" : "es"}`}</div></div></div>`;
};

// Dialogs and toasts

export interface LinkState {
  readonly step: "paste" | "preview";
  readonly input: string;
  readonly preview: {
    readonly steamId: string;
    readonly personaName: string;
    readonly campaignTracks: number;
    readonly campaignTrackTotal: number;
  } | null;
  readonly error: string;
  /** The Match being joined once linked, if any. */
  readonly joining: MatchView | null;
  /** Changing an existing Link. */
  readonly changing: boolean;
  readonly busy: boolean;
}

const howtoHtml = (parts: ReadonlyArray<HowtoPart>) =>
  parts
    .map((p) =>
      typeof p === "string"
        ? esc(p)
        : "menu" in p
          ? `<b style="color:var(--text)">${esc(p.menu)}</b>`
          : `<code style="color:var(--text);overflow-wrap:anywhere">${esc(p.example)}</code>`,
    )
    .join("");

export const linkDialog = (s: LinkState, viewer: Viewer) => {
  const title = s.changing ? "Change your Steam account" : "Link your Steam account";
  const ctx =
    s.joining === null
      ? ""
      : `<div class="ctx">${stackOf(s.joining, 20)}<span>Joining ${titleOf(s.joining)}</span></div>`;
  let body: string;
  if (s.step === "preview" && s.preview !== null) {
    const p = s.preview;
    const yes =
      s.joining !== null ? "Link and join" : s.changing ? "Yes, link this one" : "Yes, link it";
    body = `<div class="found">${marble(p.steamId, 52)}<div style="min-width:0"><div class="hud" style="font-weight:700;font-size:18px">${esc(p.personaName)}</div><div class="note">SteamID ${esc(p.steamId)} · times on ${p.campaignTracks} of ${p.campaignTrackTotal} Circuit Tracks</div></div></div>
      <div class="note" style="font-size:13px;color:var(--dim)">Is this you?</div>${s.error === "" ? "" : `<div class="err">${esc(s.error)}</div>`}
      <div class="row-btns">${btn("confirm", yes, "go", s.busy)}${btn("retry", "Try again", "ghost", s.busy)}</div>`;
  } else {
    const current =
      s.changing && viewer.link !== null
        ? `<div class="note" style="font-size:13px;color:var(--dim)">Linked to <b style="color:var(--text)">${esc(viewer.link.personaName)}</b> (${esc(viewer.link.steamId)}).</div>`
        : "";
    body = `${current}<ol class="note" style="font-size:13px;color:var(--dim);margin:0;padding-left:20px;display:grid;gap:4px">${STEAM_LINK_HOWTO.steps.map((step) => `<li>${howtoHtml(step)}</li>`).join("")}</ol>
      <div class="note" style="font-size:13px;color:var(--dim)">${howtoHtml(STEAM_LINK_HOWTO.looksLike)}<br>${esc(STEAM_LINK_HOWTO.notThis)}</div>
      <label class="label" for="profile">Steam profile link</label>
      <div class="field"><input id="profile" value="${esc(s.input)}" autocomplete="off" spellcheck="false">${btn("check", "Check", "go", s.busy)}</div>
      ${s.error === "" ? "" : `<div class="err">${esc(s.error)}</div>`}`;
  }
  return `<div class="overlay" data-act="close-link"><div class="dialog" role="dialog" aria-modal="true" aria-label="${title}" data-stop><div class="form"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="mt" style="font-size:20px">${title}</span><button class="link" data-act="close-link">Close</button></div>${ctx}${body}</div></div></div>`;
};

export const leaveDialog = (m: MatchView, busy: boolean) =>
  `<div class="overlay" data-act="stay"><div class="dialog" role="dialog" aria-modal="true" aria-label="Leave this Match?" data-stop><div class="form"><span class="mt" style="font-size:20px">Leave this Match?</span><div class="note" style="font-size:13px;color:var(--dim)">Your best time so far stands, but nothing after this counts.</div><div class="row-btns">${btn(`leave-confirm:${m.matchId}`, "Leave", "warn", busy)}${btn("stay", "Stay", "go", busy)}</div></div></div></div>`;

export const toast = (text: string) => `<div class="toast" role="alert">${esc(text)}</div>`;
