// A Match on screen: the Board Slab, your line, the Medal track, the progression graph and the
// Improvements feed, and the screens built from them (watching, racing, the Result, your Invite
// before the start). What a Match says is shared with the Card: its rows and words come from
// present.ts, its PBs from `progress`, and what the viewer may press from the server.
import type { ReactNode } from "react";
import {
  formatTime,
  MATCH_TYPE_NAME,
  type MedalKind,
  medalFor,
  progress,
  SCORE_TICKS_PER_SECOND,
} from "../../../domain.js";
import { boardRows, formatGap, mapTitle, matchDetails, matchName } from "../../../present.js";
import { hueFor } from "../../../render/art.js";
import type { MatchView } from "../../api.js";
import { clockText } from "../clock.js";
import type { Viewer } from "../types.js";
import { Countdown, Logo, MapArt, MarbleIn, Medal } from "./art.js";
import { Btn, MeLink, useActions } from "./controls.js";

export const MEDALS: ReadonlyArray<MedalKind> = ["bronze", "silver", "gold", "author"];
/** The graph's and the Medal track's line colours; author is the design system's purple. */
const MEDAL_LINE: Record<MedalKind, string> = {
  bronze: "#e0a650",
  silver: "#c9c9c9",
  gold: "#ffe600",
  author: "#b36be8",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const secs = (ticks: number) => ticks / SCORE_TICKS_PER_SECOND;
export const rankClass = (r: number | null) =>
  r === 1 ? "r1" : r === 2 ? "r2" : r === 3 ? "r3" : "rn";

// ---------------------------------------------------------------- a Match, derived

export const nameOf = (m: MatchView) => (discordId: string) => m.names[discordId] ?? "Player";
const nameBySteam = (m: MatchView, steamId: string) => {
  const p = m.players.find((pl) => pl.steamId === steamId);
  return p === undefined ? "Player" : nameOf(m)(p.discordId);
};
export const titleOf = (m: MatchView) => matchName(m, nameOf(m));

/** When the Match started, on the server's clock. */
export const startedAt = (m: MatchView) => (m.endsAt ?? 0) - m.minutes * 60_000;

export const Chip = ({ m }: { readonly m: MatchView }) =>
  m.state === "invite" ? (
    <span className="chip">
      Invite · <Countdown at={m.expiresAt} />
    </span>
  ) : m.state === "live" ? (
    <span className="chip live">
      Live · <Countdown at={m.endsAt} />
    </span>
  ) : (
    <span className="chip final">Final</span>
  );

export const Stack = ({ m, size = 22 }: { readonly m: MatchView; readonly size?: number }) => (
  <span className="stack">
    {m.players.map((p) => (
      <MarbleIn key={p.steamId} m={m} steamId={p.steamId} size={size} />
    ))}
  </span>
);

// ---------------------------------------------------------------- the Match's parts

/** The Board Slab: the Card's rows. */
const Slab = ({ m, viewer }: { readonly m: MatchView; readonly viewer: Viewer }) => (
  <div className="panel slab">
    {boardRows(m, nameOf(m)).map((r, i) => {
      const me = r.discordId === viewer.discordId && !r.faded;
      return (
        <div
          key={r.steamId ?? `open-${i}`}
          className={`row ${me ? "me" : ""} ${r.faded ? "open" : ""}`}
        >
          <span className={`rk ${r.faded ? "rn" : rankClass(r.place)}`}>{r.rank}</span>
          <MarbleIn m={m} steamId={r.steamId} size={26} />
          <div style={{ minWidth: 0 }}>
            <div className="nm">{r.name}</div>
            {r.note === "" ? null : <div className="note">{r.note}</div>}
          </div>
          <div className="sc">
            {r.score === "ready" ? (
              <span className="note">ready</span>
            ) : r.score === "—" ? (
              <span className="rn">—</span>
            ) : r.score === "DNF" ? (
              <span className="dnf">DNF</span>
            ) : (
              <>
                {r.score}
                {r.worldRecord ? <span className="wr">WR</span> : <Medal kind={r.medal} />}
              </>
            )}
          </div>
        </div>
      );
    })}
  </div>
);

/** Your place, your gap to P1, and your gap to the next Medal. */
const YourLine = ({ m, viewer }: { readonly m: MatchView; readonly viewer: Viewer }) => {
  const me = m.standings.find((s) => s.player.discordId === viewer.discordId);
  const leader = m.standings[0];
  if (m.map === null || me?.ticks == null || me.rank === null || leader === undefined) return null;
  const medals = m.map.medals;
  const t = me.ticks;
  const next = MEDALS.find((k) => secs(t) > medals[k]);
  return (
    <div className="yourline">
      You&apos;re <b className={rankClass(me.rank)}>P{me.rank}</b> ·{" "}
      {me.rank === 1 ? (
        <b>leading</b>
      ) : (
        <>
          <b>+{formatGap(t - (leader.ticks ?? t))}</b> to {nameOf(m)(leader.player.discordId)}
        </>
      )}{" "}
      ·{" "}
      {next === undefined ? (
        "every Medal"
      ) : (
        <>
          <b>{(secs(t) - medals[next]).toFixed(3)}</b> to {next}
        </>
      )}
    </div>
  );
};

/** Everyone's best time on a bar of the four Medals, with the world record marked. */
const Track = ({ m, viewer }: { readonly m: MatchView; readonly viewer: Viewer }) => {
  if (m.map === null) return null;
  const medals = m.map.medals;
  const lo = secs(m.map.worldRecordTicks) * 0.95;
  const hi = medals.bronze * 1.05;
  const pct = (s: number) => Math.max(0, Math.min(100, ((hi - s) / (hi - lo)) * 100));
  const x = (s: number) => `${pct(s).toFixed(2)}%`;
  // Each band runs from its Medal's time to the next one's, so a pin sits in the colour it earned.
  const edges = [0, ...MEDALS.map((k) => pct(medals[k])), 100];
  const fills = ["#1f1f22", ...MEDALS.map((k) => `var(--mg-${k})`)];
  return (
    <div className="track" aria-label="Medal track">
      <div className="bar">
        {fills.map((fill, i) => (
          <i
            key={fill}
            style={{
              flex: `0 0 ${((edges[i + 1] ?? 100) - (edges[i] ?? 0)).toFixed(2)}%`,
              background: fill,
            }}
          />
        ))}
      </div>
      {m.standings.map((s) => {
        if (s.ticks === null) return null;
        const me = s.player.discordId === viewer.discordId;
        return (
          <div
            key={s.player.steamId}
            className="pin"
            style={{ left: x(secs(s.ticks)), zIndex: me ? 3 : 1 }}
            title={nameOf(m)(s.player.discordId)}
          >
            <MarbleIn m={m} steamId={s.player.steamId} size={me ? 28 : 22} />
          </div>
        );
      })}
      {MEDALS.map((k) => (
        <span key={k} className="tl" style={{ left: x(medals[k]) }}>
          {cap(k)[0]} {medals[k].toFixed(1)}
        </span>
      ))}
      <span className="tl" style={{ left: x(secs(m.map.worldRecordTicks)), color: "var(--gold)" }}>
        WR
      </span>
    </div>
  );
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

const Label = ({
  x,
  y,
  fill,
  children,
  anchor = "end",
  size = 9.5,
}: {
  readonly x: number;
  readonly y: number;
  readonly fill: string;
  readonly children: ReactNode;
  readonly anchor?: "end" | "middle";
  readonly size?: number;
}) => (
  <text
    x={x.toFixed(1)}
    y={y.toFixed(1)}
    fill={fill}
    fontFamily="Chakra Petch"
    fontSize={size}
    textAnchor={anchor}
  >
    {children}
  </text>
);

/**
 * The progression graph: every PB over the Match clock, log-scaled, with the Medal and WR lines,
 * PBs brought into the Match dotted until beaten, and a star on each world-record break.
 */
const Graph = ({
  m,
  now,
  wide,
}: {
  readonly m: MatchView;
  readonly now: number;
  readonly wide: boolean;
}) => {
  if (m.map === null) return null;
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
  const step = dur >= 1200 ? 300 : dur >= 600 ? 120 : 60;
  const minutes: Array<number> = [];
  for (let s = 0; s <= dur; s += step) minutes.push(s);
  return (
    <div className="panel graph">
      <div className="panel-h">
        <span className="label">Progression</span>
        <span className="note">{m.state === "live" ? "live" : "final"}</span>
      </div>
      <div style={{ padding: "6px 8px" }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Progression graph">
          {minutes.map((s) => (
            <g key={s}>
              <line x1={x(s)} x2={x(s)} y1={T} y2={H - B} stroke="rgba(255,255,255,.05)" />
              <Label x={x(s)} y={H - 10} fill="#63719a" anchor="middle" size={10}>
                {clockText(s)}
              </Label>
            </g>
          ))}
          {MEDALS.map((k) => {
            const v = map.medals[k];
            if (v > hi || v < lo) return null;
            return (
              <g key={k}>
                <line
                  x1={L}
                  x2={W - R}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={MEDAL_LINE[k]}
                  strokeOpacity=".55"
                  strokeDasharray="2 4"
                />
                <Label x={L - 6} y={y(v) + 3} fill={MEDAL_LINE[k]}>
                  {v.toFixed(1)}
                </Label>
              </g>
            );
          })}
          <line
            x1={L}
            x2={W - R}
            y1={y(wr)}
            y2={y(wr)}
            stroke="#fff"
            strokeOpacity=".6"
            strokeDasharray="4 3"
          />
          <Label x={L - 6} y={y(wr) + 3} fill="#fff">
            WR
          </Label>
          {m.state === "live" ? (
            <line x1={x(at)} x2={x(at)} y1={T} y2={H - B} stroke="#8be03c" strokeOpacity=".5" />
          ) : null}
          {m.players.map((p) => {
            const pts = m.history
              .filter((e) => e.steamId === p.steamId)
              .map((e) => [e.at / 1000, secs(e.ticks)] as const);
            const colour = `hsl(${hueFor(p.steamId)} 78% 60%)`;
            const pb = pbs[p.steamId];
            const first = pts[0];
            const broughtIn =
              pb !== undefined && (first === undefined || first[1] > secs(pb)) ? (
                <line
                  x1={x(0)}
                  x2={x(first === undefined ? at : first[0])}
                  y1={y(secs(pb))}
                  y2={y(secs(pb))}
                  stroke={colour}
                  strokeWidth="2"
                  strokeDasharray="2 3"
                />
              ) : null;
            if (first === undefined) return <g key={p.steamId}>{broughtIn}</g>;
            let d = `M${x(first[0]).toFixed(1)} ${y(first[1]).toFixed(1)}`;
            for (const [a, t] of pts.slice(1)) d += ` H${x(a).toFixed(1)} V${y(t).toFixed(1)}`;
            d += ` H${x(at).toFixed(1)}`;
            const last = pts[pts.length - 1] ?? first;
            return (
              <g key={p.steamId}>
                {broughtIn}
                <path d={d} fill="none" stroke={colour} strokeWidth="2.3" />
                {pts.map(([a, t]) => (
                  <circle
                    key={`${a}-${t}`}
                    cx={x(a).toFixed(1)}
                    cy={y(t).toFixed(1)}
                    r="2.8"
                    fill={colour}
                  />
                ))}
                <text
                  x={(x(at) + 8).toFixed(1)}
                  y={(y(last[1]) + 4).toFixed(1)}
                  fill={colour}
                  fontFamily="Archivo"
                  fontWeight="600"
                  fontSize="11"
                >
                  {nameOf(m)(p.discordId)}
                </text>
              </g>
            );
          })}
          {progress(map, m.history)
            .filter((e) => e.beatWorldRecord !== null)
            .map((e) => {
              const cx = x(e.at / 1000),
                cy = y(secs(e.ticks));
              return (
                <g key={`${e.steamId}-${e.at}`}>
                  <circle
                    cx={cx.toFixed(1)}
                    cy={cy.toFixed(1)}
                    r="10"
                    fill="#ffd447"
                    fillOpacity=".18"
                  />
                  <path d={star(cx, cy, 7, 3)} fill="#ffd447" stroke="#111" />
                </g>
              );
            })}
        </svg>
      </div>
    </div>
  );
};

/** The Improvements feed: every PB as the Match Thread posted it, newest first, stamped with the Match clock. */
const Feed = ({ m }: { readonly m: MatchView }) => {
  const map = m.map;
  const ev = map === null ? [] : [...progress(map, m.history)].reverse();
  return (
    <div className="panel">
      <div className="panel-h">
        <span className="label">Improvements · {ev.length}</span>
      </div>
      <div className="feed scroll">
        {ev.length === 0 ? (
          <div style={{ padding: 14 }} className="note">
            No times yet.
          </div>
        ) : (
          ev.map((e) => {
            const at = clockText(e.at / 1000);
            const key = `${e.steamId}-${e.at}`;
            if (e.beatWorldRecord !== null)
              return (
                <div key={key} className="imp wrk">
                  <span className="pk">WR</span>
                  <MarbleIn m={m} steamId={e.steamId} size={26} />
                  <div style={{ minWidth: 0 }}>
                    <div className="nm">{nameBySteam(m, e.steamId)}</div>
                    <div className="sub">
                      beat {formatTime(e.beatWorldRecord)} by{" "}
                      {formatGap(e.beatWorldRecord - e.ticks)} · at {at}
                    </div>
                  </div>
                  <span className="tm">{formatTime(e.ticks)}</span>
                </div>
              );
            const kind = map === null ? null : medalFor(e.ticks, map.medals);
            return (
              <div key={key} className={`imp ${e.rank === 1 ? "gold" : ""}`}>
                <span className="pk">P{e.rank}</span>
                <MarbleIn m={m} steamId={e.steamId} size={24} />
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{nameBySteam(m, e.steamId)}</div>
                  <div className="note">
                    at <span className="stamp">{at}</span>
                    {e.previousTicks === null ? " · first time" : ""}
                  </div>
                </div>
                <span className="tm">
                  {formatTime(e.ticks)}
                  {e.previousTicks === null ? null : (
                    <span className="diff" style={{ fontSize: 12.5 }}>
                      -{formatGap(e.previousTicks - e.ticks)}
                    </span>
                  )}
                  <Medal kind={kind} />
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- buttons

/** What the viewer may press on a Match they aren't in, on its tile (`tile`) or in its Match view. */
export const Offer = ({
  m,
  tile,
  pb,
}: {
  readonly m: MatchView;
  readonly tile: boolean;
  readonly pb?: number | null | undefined;
}) => {
  const a = useActions();
  if (m.state === "finished") return null;
  const can = (x: string) => m.actions.some((y) => y === x);
  const any = can("accept") || can("decline") || can("join");
  return (
    <>
      {can("accept") ? (
        <Btn look="go sm" onClick={() => a.accept(m.matchId)}>
          Accept
        </Btn>
      ) : null}
      {can("decline") ? (
        <>
          <Btn look="warn sm" onClick={() => a.decline(m.matchId)}>
            Decline
          </Btn>
          <span className="why">
            <Countdown at={m.expiresAt} /> to answer
          </span>
        </>
      ) : null}
      {can("join") ? (
        <Btn look="go sm" onClick={() => a.join(m.matchId)}>
          {m.state === "live" ? "Join late" : `Join (${m.players.length})`}
        </Btn>
      ) : null}
      {tile && (m.state === "live" || !any) ? (
        <Btn look={`sm ${any ? "ghost" : ""}`} free onClick={() => a.watch(m)}>
          Watch
        </Btn>
      ) : null}
      {!tile && can("join") && m.state === "live" && pb != null ? (
        <span className="why">Your PB {formatTime(pb)} is the time to beat</span>
      ) : null}
    </>
  );
};

const ResultButtons = ({ m }: { readonly m: MatchView }) => {
  const a = useActions();
  return (
    <>
      {m.links === null ? null : (
        <Btn look="sm" free onClick={() => a.external(m.links?.card ?? "")}>
          See it in the channel
        </Btn>
      )}
      <Btn look="go sm" free onClick={a.back}>
        Back to Matches
      </Btn>
    </>
  );
};

/** Your own live Match's buttons, and a Result's. */
const OwnButtons = ({ m }: { readonly m: MatchView }) => {
  const a = useActions();
  if (m.state !== "live") return <ResultButtons m={m} />;
  const thread = m.links?.thread ?? null;
  return (
    <>
      {m.map === null ? null : <WorkshopButton pfid={m.map.pfid} />}
      {thread === null ? null : (
        <Btn look="sm" free onClick={() => a.external(thread)}>
          Match Thread
        </Btn>
      )}
      {m.actions.includes("leave") ? (
        <Btn look="warn sm" onClick={() => a.leave(m)}>
          Leave
        </Btn>
      ) : null}
    </>
  );
};

const WorkshopButton = ({ pfid }: { readonly pfid: string }) => {
  const a = useActions();
  return (
    <Btn look="sm" free onClick={() => a.workshop(pfid)}>
      Open Map in Workshop
    </Btn>
  );
};

// ---------------------------------------------------------------- screens

/** The Card Stack: your Invite before the start. */
const CardStack = ({
  m,
  viewer,
  line,
  chips,
  dock,
  extra,
}: {
  readonly m: MatchView;
  readonly viewer: Viewer;
  readonly line: ReactNode;
  readonly chips: ReactNode;
  readonly dock: ReactNode;
  readonly extra?: ReactNode;
}) => (
  <div className="vA">
    <div className="top">
      <Logo />
      <span className="note">{titleOf(m)}</span>
    </div>
    <div className="hero">
      <div className="sealed">?</div>
      <div className="scrim" />
      <div className="copy">
        <div className="mt">{line}</div>
        <div className="hud" style={{ fontSize: 12, color: "var(--dim)" }}>
          {matchDetails(m)}
        </div>
        <div className="row-btns">
          {chips}
          <span className="chip you">Your Match</span>
        </div>
      </div>
    </div>
    <Slab m={m} viewer={viewer} />
    {extra}
    <div className="dock">{dock}</div>
  </div>
);

/** Your open Invite: hosting a Lobby, waiting in someone else's, or waiting on your 1v1. */
export const MyInvite = ({ m, viewer }: { readonly m: MatchView; readonly viewer: Viewer }) => {
  const a = useActions();
  const id = m.matchId;
  const pinged =
    m.type === "lobby" ? (
      <div className="panel" style={{ padding: "12px 14px" }}>
        <span className="note">Players get pinged in the Match Thread when it starts.</span>
      </div>
    ) : null;
  const stack = (dock: ReactNode, extra?: ReactNode) => (
    <CardStack
      m={m}
      viewer={viewer}
      line={mapTitle(m)}
      chips={<Chip m={m} />}
      dock={dock}
      extra={extra}
    />
  );
  if (m.actions.includes("start"))
    return stack(
      <>
        <span className="note">
          Invite expires in <Countdown at={m.expiresAt} />
        </span>
        <span className="row-btns">
          <Btn look="ghost" onClick={() => a.cancel(id)}>
            Cancel
          </Btn>
          <Btn look="go" onClick={() => a.start(id)}>
            Start · {m.players.length} Player{m.players.length === 1 ? "" : "s"}
          </Btn>
        </span>
      </>,
      pinged,
    );
  if (m.actions.includes("leave"))
    return stack(
      <>
        <span className="note">Waiting for {nameOf(m)(m.creator.discordId)} to start</span>
        <span>
          <Btn look="ghost" onClick={() => a.leave(m)}>
            Leave
          </Btn>
        </span>
      </>,
      pinged,
    );
  const other =
    m.type === "challenge" && m.target !== null
      ? nameOf(m)(m.target.discordId)
      : "someone to accept";
  return stack(
    <>
      <span className="note">
        Waiting for {other} · <Countdown at={m.expiresAt} /> left
      </span>
      <span>
        <Btn look="ghost" onClick={() => a.cancel(id)}>
          Cancel
        </Btn>
      </span>
    </>,
  );
};

/** Start or Accept pressed: the server is picking a Map. */
export const Picking = ({ m, viewer }: { readonly m: MatchView; readonly viewer: Viewer }) => (
  <CardStack
    m={m}
    viewer={viewer}
    line={
      <>
        Picking a Map…
        <span className="dots" />
      </>
    }
    chips={<span className="chip">Starting</span>}
    dock={
      <>
        <span className="note">Up to 20 seconds</span>
        <span>
          <Btn disabled>Starting…</Btn>
        </span>
      </>
    }
  />
);

/** No Map fitted, so the Invite was cancelled. */
export const NoMap = ({ m, viewer }: { readonly m: MatchView; readonly viewer: Viewer }) => {
  const a = useActions();
  return (
    <CardStack
      m={m}
      viewer={viewer}
      line="No Map fits"
      chips={<span className="chip">Cancelled</span>}
      dock={
        <>
          <span className="note">
            No Map fits a {m.minutes}-minute Match, so the {MATCH_TYPE_NAME[m.type]} was cancelled.
          </span>
          <span>
            <Btn look="go" free onClick={a.back}>
              Back to Matches
            </Btn>
          </span>
        </>
      }
    />
  );
};

/** Watching, racing and the Result, straight down. `locked`: it's the viewer's own Match. */
export const MatchScreen = ({
  m,
  viewer,
  locked,
  now,
  wide,
  pb,
  reveal,
}: {
  readonly m: MatchView;
  readonly viewer: Viewer;
  readonly locked: boolean;
  /** The server's clock now. */
  readonly now: number;
  readonly wide: boolean;
  /** The viewer's PB on the Map, for a late join; undefined until read. */
  readonly pb: number | null | undefined;
  /** The Map was just drawn: slide the art in. */
  readonly reveal: boolean;
}) => {
  const a = useActions();
  return (
    <div className={`vE ${reveal ? "reveal-in" : ""}`}>
      <div className="top">
        {locked ? (
          <>
            <Logo />
            <span />
          </>
        ) : (
          <>
            <button className="link" onClick={a.back}>
              ← All Matches
            </button>
            <MeLink viewer={viewer} />
          </>
        )}
      </div>
      <div className="hero">
        <MapArt m={m} />
        <div className="ov">
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
          >
            <span className="row-btns">
              <Chip m={m} />
              {locked ? <span className="chip you">Your Match</span> : null}
            </span>
            <Stack m={m} size={26} />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div className="mt">{mapTitle(m)}</div>
            <div className="note" style={{ color: "#c9d3f0" }}>
              {titleOf(m)} · {matchDetails(m)}
            </div>
            <div className="row-btns">
              {m.state === "finished" ? (
                <ResultButtons m={m} />
              ) : locked ? (
                <OwnButtons m={m} />
              ) : (
                <Offer m={m} tile={false} pb={pb} />
              )}
            </div>
          </div>
        </div>
      </div>
      {locked && m.state !== "invite" ? <YourLine m={m} viewer={viewer} /> : null}
      {m.map === null ? (
        <Slab m={m} viewer={viewer} />
      ) : (
        <>
          <Track m={m} viewer={viewer} />
          <Slab m={m} viewer={viewer} />
          <Graph m={m} now={now} wide={wide} />
          <Feed m={m} />
        </>
      )}
    </div>
  );
};

/** The first moments of your live Match: Go!, when it ends (on this device's clock), and the Workshop button. */
export const GoBar = ({ m, offset }: { readonly m: MatchView; readonly offset: number }) => (
  <div className="gobar">
    <b>Go!</b> Ends at{" "}
    {new Date((m.endsAt ?? 0) - offset).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}{" "}
    {m.map === null ? null : <WorkshopButton pfid={m.map.pfid} />}
  </div>
);
