"use client";
// ======================= PROTOTYPE (grill-design, never merged) =======================
// Ghost-derived data on a board's rows. Data: /prototype/ghosts.json, built from the top
// 50 ghost replays of each Track (scratch script, not the collector). The variant comes
// from ?variant=, the picker sits bottom-right. Everything for the prototype is in this
// file plus three hooks in BoardBody.tsx marked PROTOTYPE.
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { fmtTime } from "../../lib/rules";

export interface Ghost {
  rank: number;
  set: string | null;
  avg: number;
  top: number;
  dist: number;
  skin: string | null;
  hat: string | null;
  path: Array<[number, number]>;
  gap: Array<number>;
  splits: Array<number> | null;
  /* by distance fraction i/80, i=1..80: time reached (s), speed (km/h), height above the start (m) */
  at: Array<number>;
  spd: Array<number>;
  elev: Array<number>;
}
type Data = Record<string, { top: number; entries: Record<string, Ghost> }>;

/* round 2 asks what picture of a run C's drawer shows; round 1's variants are kept below,
   switched off by ROUND */
const ROUND: number = 3;
export const VARIANTS = [
  { key: "A", name: "Stacked", note: "the race on top, playing on open; the gap chart under it, still" },
  { key: "B", name: "Linked", note: "the gap chart's playhead follows the race; drag the chart to scrub" },
  { key: "C", name: "Tabs", note: "a Gap / Race switch; the race plays when picked" },
  { key: "D", name: "Ride", note: "no lanes: the marbles race on the gap chart itself, the leader along the line" },
  { key: "E", name: "Side by side", note: "race and gap next to each other (stacked on a phone), both playing" },
] as const;
export const ROUND2 = [
  { key: "A", name: "Gap", note: "time behind the leader along the course, where it was lost named" },
  { key: "B", name: "Speed", note: "this run's speed along the course over the leader's, green where faster" },
  { key: "C", name: "Side view", note: "the course's climbs and drops from the side, coloured by this run's speed" },
  { key: "D", name: "Race", note: "this run and the leader's as two marbles racing in real time, with replay" },
  { key: "E", name: "Sectors", note: "the course cut into 8 equal sectors, each one's time against the leader's" },
] as const;
export const ROUND1 = [
  { key: "A", name: "Chips", note: "a line of stat chips under the gap line: avg, top speed, distance, when, hat" },
  { key: "B", name: "Columns", note: "Avg, Top and Set columns before Time (phone: one line under the name)" },
  { key: "C", name: "Expand", note: "tap a row to open a drawer: route over the leader's, the gap along the course, the stats" },
  { key: "D", name: "Lens", note: "a switch over the board swaps the right column between Time, speeds, distance and date" },
  { key: "E", name: "Run card", note: "tap a row for a run card beside the board (a sheet on a phone); rows get a speed bar" },
] as const;
export type Variant = (typeof VARIANTS)[number]["key"];

function readVariant(): Variant {
  const v = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return (VARIANTS.find((x) => x.key === v)?.key ?? "A") as Variant;
}

let cache: Promise<Data> | null = null;
const load = () => (cache ??= fetch("/prototype/ghosts.json").then((r) => r.json() as Promise<Data>));

interface Ctx {
  variant: Variant;
  board: string;
  data: Data | null;
  open: string | null;
  setOpen: (id: string | null) => void;
  lens: Lens;
  setLens: (l: Lens) => void;
}
const ProtoCtx = createContext<Ctx | null>(null);
export const useProto = () => useContext(ProtoCtx);

export type Lens = "time" | "avg" | "top" | "dist" | "set";

export function ProtoProvider({ board, children }: { board: string; children: React.ReactNode }) {
  const [variant, setVariant] = useState<Variant>("A");
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("time");
  useEffect(() => {
    setVariant(readVariant());
    const on = () => {
      setVariant(readVariant());
      setOpen(null);
    };
    addEventListener("proto-variant", on);
    void load().then(setData);
    return () => {
      removeEventListener("proto-variant", on);
    };
  }, []);
  return (
    <ProtoCtx.Provider value={{ variant, board, data, open, setOpen, lens, setLens }}>
      <style>{CSS}</style>
      <div className={`p-v-${variant}`} style={{ display: "contents" }}>
        {children}
      </div>
      <Picker variant={variant} />
      {ROUND === 1 && variant === "E" && <RunCard />}
    </ProtoCtx.Provider>
  );
}

export function ghostOf(c: Ctx | null, id: string): Ghost | null {
  return c?.data?.[c.board]?.entries[id] ?? null;
}
const leaderOf = (c: Ctx) => {
  const e = c.data?.[c.board]?.entries;
  return e ? Object.values(e).sort((a, b) => a.rank - b.rank)[0] ?? null : null;
};

/* ---------- formatting ---------- */
const kmh = (n: number) => `${n.toFixed(1)} km/h`;
function ago(iso: string | null) {
  if (!iso) return "date unknown";
  const d = (Date.now() - Date.parse(iso)) / 864e5;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 45) return `${Math.floor(d)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "?";

/* ---------- pieces ---------- */
function Route({ g, lead, size = 120 }: { g: Ghost; lead: Ghost | null; size?: number }) {
  const pts = (p: Array<[number, number]>) => p.map(([x, y]) => `${(x * 100).toFixed(1)},${(y * 100).toFixed(1)}`).join(" ");
  return (
    <svg className="p-route" viewBox="-4 -4 108 108" width={size} height={size} aria-label="Route from above">
      {lead && lead !== g && <polyline points={pts(lead.path)} className="p-route-lead" />}
      <polyline points={pts(g.path)} className="p-route-me" />
      <circle cx={g.path[0][0] * 100} cy={g.path[0][1] * 100} r="3" className="p-route-start" />
    </svg>
  );
}

function GapLine({ g, w = 220, h = 54 }: { g: Ghost; w?: number; h?: number }) {
  const max = Math.max(0.05, ...g.gap.map(Math.abs));
  const pts = g.gap.map((v, i) => `${((i + 1) / g.gap.length) * w},${3 + (Math.max(0, v) / max) * (h - 6)}`);
  return (
    <svg className="p-gap" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <line x1="0" x2={w} y1={3} y2={3} className="p-gap-zero" />
      <polyline points={`0,3 ` + pts.join(" ")} className="p-gap-line" />
    </svg>
  );
}

function Stats({ g }: { g: Ghost }) {
  return (
    <dl className="p-stats">
      <div><dt>Avg speed</dt><dd>{kmh(g.avg)}</dd></div>
      <div><dt>Top speed</dt><dd>{kmh(g.top)}</dd></div>
      <div><dt>Distance</dt><dd>{g.dist.toFixed(0)} m</dd></div>
      <div><dt>Set</dt><dd>{ago(g.set)}</dd></div>
      <div><dt>Ball</dt><dd>{g.skin ?? "Default"}{g.hat ? ` + ${g.hat}` : ""}</dd></div>
    </dl>
  );
}

function Detail({ g, c }: { g: Ghost; c: Ctx }) {
  const lead = leaderOf(c);
  const last = g.gap[g.gap.length - 1];
  if (ROUND === 3) return <Picture3 g={g} lead={lead} c={c} />;
  if (ROUND === 2) return <Picture g={g} lead={lead} c={c} />;
  return (
    <div className="p-detail">
      <Route g={g} lead={lead} />
      <div className="p-detail-main">
        <Stats g={g} />
        {g.rank > 1 && (
          <>
            <p className="p-cap">Behind the leader along the course, {fmtTime(Math.round(last * 1e5))} at the line</p>
            <GapLine g={g} />
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- round 2: the picture in the drawer ---------- */
const W = 600;
const pct = (i: number, n: number) => ((i + 1) / n) * W;
const secs = (s: number) => fmtTime(Math.round(Math.abs(s) * 1e5));
const signed = (s: number) => (s >= 0 ? "+" : "−") + secs(s);

function Picture({ g, lead, c }: { g: Ghost; lead: Ghost | null; c: Ctx }) {
  const L = lead && lead !== g ? lead : null;
  const v = c.variant;
  return (
    <div className="p-pic">
      {v === "A" && <GapPic g={g} lead={L} />}
      {v === "B" && <SpeedPic g={g} lead={L} />}
      {v === "C" && <SidePic g={g} />}
      {v === "D" && <RacePic g={g} lead={L} />}
      {v === "E" && <SectorPic g={g} lead={L} c={c} />}
      <Stats g={g} />
    </div>
  );
}

const leaderNote = (lead: Ghost | null) =>
  lead ? null : <p className="p-cap">This is the fastest replay read here, so there is nothing to compare it with.</p>;

function GapPic({ g, lead }: { g: Ghost; lead: Ghost | null }) {
  if (!lead) return leaderNote(lead);
  const gap = g.at.map((t, i) => t - lead.at[i]);
  const h = 90;
  const max = Math.max(0.02, ...gap.map(Math.abs));
  const y = (d: number) => h / 2 + (d / max) * (h / 2 - 4);
  /* the stretch where the most time went: the steepest tenth */
  let worst = 0, wi = 0;
  for (let i = 8; i < gap.length; i++) {
    const d = gap[i] - gap[i - 8];
    if (d > worst) { worst = d; wi = i - 8; }
  }
  const from = Math.round((wi / gap.length) * 100);
  return (
    <>
      <p className="p-cap">
        Behind the leader along the course · <b>{signed(gap[gap.length - 1])}</b> at the line. Most lost between {from}% and {from + 10}% of the way: {secs(worst)}.
      </p>
      <svg className="p-chart" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none">
        <rect x={(wi / gap.length) * W} width={(8 / gap.length) * W} y="0" height={h} className="p-hot" />
        <line x1="0" x2={W} y1={h / 2} y2={h / 2} className="p-zero" />
        <polyline points={`0,${h / 2} ` + gap.map((d, i) => `${pct(i, gap.length)},${y(d)}`).join(" ")} className="p-ln-me" />
      </svg>
      <div className="p-axis"><span>start</span><span>ahead ↑ · behind ↓</span><span>finish</span></div>
    </>
  );
}

function SpeedPic({ g, lead }: { g: Ghost; lead: Ghost | null }) {
  const h = 110;
  const all = [...g.spd, ...(lead?.spd ?? [])];
  const lo = Math.min(...all) * 0.9, hi = Math.max(...all);
  const y = (s: number) => h - 4 - ((s - lo) / (hi - lo)) * (h - 8);
  const line = (a: Array<number>) => `0,${y(a[0])} ` + a.map((s, i) => `${pct(i, a.length)},${y(s)}`).join(" ");
  return (
    <>
      <p className="p-cap">
        Speed along the course · top <b>{g.top.toFixed(0)} km/h</b>
        {lead && <>, the leader’s dashed</>}
      </p>
      <svg className="p-chart" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none">
        {lead &&
          g.spd.map((s, i) => (
            <rect key={i} x={pct(i - 1, g.spd.length)} width={W / g.spd.length} y="0" height={h} className={s >= lead.spd[i] ? "p-fast" : "p-slow"} />
          ))}
        {lead && <polyline points={line(lead.spd)} className="p-ln-lead" />}
        <polyline points={line(g.spd)} className="p-ln-me" />
      </svg>
      <div className="p-axis"><span>start</span><span>{lead ? "green: faster than the leader there" : ""}</span><span>finish</span></div>
    </>
  );
}

function SidePic({ g }: { g: Ghost }) {
  const h = 120;
  const lo = Math.min(0, ...g.elev), hi = Math.max(0.5, ...g.elev);
  const y = (e: number) => h - 6 - ((e - lo) / (hi - lo)) * (h - 20);
  const sLo = Math.min(...g.spd), sHi = Math.max(...g.spd);
  const pts = [0, ...g.elev];
  const ti = g.spd.indexOf(Math.max(...g.spd));
  return (
    <>
      <p className="p-cap">
        The course from the side, coloured by this run’s speed · {(hi - lo).toFixed(0)} m from lowest to highest
      </p>
      <svg className="p-chart" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none">
        <polygon points={`0,${h} ` + pts.map((e, i) => `${(i / g.elev.length) * W},${y(e)}`).join(" ") + ` ${W},${h}`} className="p-ground" />
        {g.elev.map((e, i) => (
          <line
            key={i}
            x1={(i / g.elev.length) * W}
            y1={y(pts[i])}
            x2={((i + 1) / g.elev.length) * W}
            y2={y(e)}
            stroke={`hsl(${200 - ((g.spd[i] - sLo) / (sHi - sLo || 1)) * 200} 90% 60%)`}
            strokeWidth="4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <circle cx={pct(ti, g.spd.length)} cy={y(g.elev[ti])} r="5" className="p-dot" />
      </svg>
      <div className="p-axis"><span>start</span><span><i className="p-key" /> slow → fast · ● top speed</span><span>finish</span></div>
    </>
  );
}

/* the fraction of the course a run has covered at time t */
function fracAt(at: Array<number>, t: number) {
  if (t <= at[0]) return (t / at[0]) / at.length;
  for (let i = 1; i < at.length; i++) if (at[i] >= t) return (i + (t - at[i - 1]) / (at[i] - at[i - 1])) / at.length;
  return 1;
}

function RacePic({ g, lead }: { g: Ghost; lead: Ghost | null }) {
  const end = g.at[g.at.length - 1];
  const [t, setT] = useState(0);
  const [run, setRun] = useState(true);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const t0 = performance.now() - t * 1000;
    const tick = (now: number) => {
      const s = (now - t0) / 1000;
      if (s >= end + 0.6) { setT(end); setRun(false); return; }
      setT(Math.min(s, end));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  const me = fracAt(g.at, t);
  const ld = lead ? fracAt(lead.at, t) : null;
  const ahead = lead ? (me - (ld ?? 0)) * g.dist : 0;
  return (
    <>
      <p className="p-cap">
        {lead ? "Racing the leader’s replay" : "The run in real time"} · <b>{fmtTime(Math.round(t * 1e5))}</b>
        {lead && t > 0.3 && <> · {Math.abs(ahead).toFixed(1)} m {ahead >= 0 ? "ahead" : "behind"}</>}
      </p>
      <div className="p-race">
        {lead && (
          <div className="p-lane">
            <span className="p-lane-name">Leader</span>
            <i className="p-mb p-mb-lead" style={{ left: `${(ld ?? 0) * 100}%` }} />
          </div>
        )}
        <div className="p-lane">
          <span className="p-lane-name">This run</span>
          <i className="p-mb" style={{ left: `${me * 100}%` }} />
        </div>
      </div>
      <button className="p-btn" onClick={() => { setT(0); setRun(true); }}>{run ? "Racing…" : "Replay"}</button>
    </>
  );
}

/* ---------- round 3: the gap and the race together ---------- */
/* the race clock: t runs 0 → the slower run's end, then stops; play() restarts it */
function useRace(end: number, auto: boolean) {
  const [t, setT] = useState(0);
  const [run, setRun] = useState(auto);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const t0 = performance.now() - t * 1000;
    const tick = (now: number) => {
      const s = (now - t0) / 1000;
      if (s >= end + 0.6) { setT(end); setRun(false); return; }
      setT(Math.min(s, end));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  return {
    t,
    run,
    play: () => { setT(0); setRun(true); },
    seek: (s: number) => { setRun(false); setT(Math.max(0, Math.min(end, s))); },
  };
}
type Race = ReturnType<typeof useRace>;

const gapOf = (g: Ghost, lead: Ghost) => g.at.map((t, i) => t - lead.at[i]);

function GapChart({ g, lead, race, ride, scrub }: { g: Ghost; lead: Ghost; race?: Race; ride?: boolean; scrub?: boolean }) {
  const gap = gapOf(g, lead);
  const h = 100;
  const max = Math.max(0.02, ...gap.map(Math.abs));
  const y = (d: number) => h / 2 + (d / max) * (h / 2 - 8);
  const me = race ? fracAt(g.at, race.t) : null;
  const ld = race ? fracAt(lead.at, race.t) : null;
  /* the gap where this run is now, interpolated */
  const gapAt = (f: number) => {
    const x = f * gap.length - 1;
    if (x <= 0) return gap[0] * Math.max(0, x + 1);
    const i = Math.min(gap.length - 2, Math.floor(x));
    return gap[i] + (gap[i + 1] - gap[i]) * (x - i);
  };
  const onScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!race || !scrub || (e.type === "pointermove" && e.buttons !== 1)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    race.seek(g.at[Math.max(0, Math.min(g.at.length - 1, Math.round(f * g.at.length) - 1))]);
  };
  return (
    <div className={"p-gapbox" + (scrub ? " p-scrub" : "")} onPointerDown={onScrub} onPointerMove={onScrub}>
      <svg className="p-chart" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={h / 2} y2={h / 2} className="p-zero" />
        <polyline points={`0,${h / 2} ` + gap.map((d, i) => `${pct(i, gap.length)},${y(d)}`).join(" ")} className="p-ln-me" />
        {race && !ride && me != null && <line x1={me * W} x2={me * W} y1="0" y2={h} className="p-head" />}
      </svg>
      <span className="p-on p-on-up">ahead</span>
      <span className="p-on p-on-dn">behind</span>
      {race && ride && me != null && ld != null && (
        <>
          <i className="p-mb p-mb-lead p-ride" style={{ left: `${ld * 100}%`, top: "50%" }} />
          <i className="p-mb p-ride" style={{ left: `${me * 100}%`, top: `${(y(gapAt(me)) / h) * 100}%` }} />
        </>
      )}
    </div>
  );
}

function Lanes({ g, lead, race }: { g: Ghost; lead: Ghost; race: Race }) {
  const me = fracAt(g.at, race.t);
  const ld = fracAt(lead.at, race.t);
  return (
    <div className="p-race">
      <div className="p-lane">
        <span className="p-lane-name">Leader</span>
        <i className="p-mb p-mb-lead" style={{ left: `${ld * 100}%` }} />
      </div>
      <div className="p-lane">
        <span className="p-lane-name">This run</span>
        <i className="p-mb" style={{ left: `${me * 100}%` }} />
      </div>
    </div>
  );
}

function RaceCap({ g, lead, race }: { g: Ghost; lead: Ghost; race: Race }) {
  const ahead = (fracAt(g.at, race.t) - fracAt(lead.at, race.t)) * g.dist;
  return (
    <span className="p-racecap">
      <b>{fmtTime(Math.round(race.t * 1e5))}</b>
      {race.t > 0.3 && <> · {Math.abs(ahead).toFixed(1)} m {ahead >= 0 ? "ahead" : "behind"}</>}
      <button className="p-btn" onClick={race.play}>{race.run ? "Racing…" : race.t ? "Replay" : "Race"}</button>
    </span>
  );
}

function Picture3({ g, lead, c }: { g: Ghost; lead: Ghost | null; c: Ctx }) {
  const L = lead && lead !== g ? lead : null;
  const end = Math.max(g.at[g.at.length - 1], L ? L.at[L.at.length - 1] : 0);
  const v = c.variant;
  const race = useRace(end, v === "A" || v === "E");
  const [tab, setTab] = useState<"gap" | "race">("gap");
  if (!L)
    return (
      <div className="p-pic">
        {leaderNote(L)}
        <Stats g={g} />
      </div>
    );
  const cap = (
    <p className="p-cap">
      Behind the leader along the course · <b>{signed(gapOf(g, L).at(-1)!)}</b> at the line
    </p>
  );
  return (
    <div className="p-pic">
      {v === "A" && (
        <>
          <RaceCap g={g} lead={L} race={race} />
          <Lanes g={g} lead={L} race={race} />
          {cap}
          <GapChart g={g} lead={L} />
        </>
      )}
      {v === "B" && (
        <>
          {cap}
          <RaceCap g={g} lead={L} race={race} />
          <Lanes g={g} lead={L} race={race} />
          <GapChart g={g} lead={L} race={race} scrub />
          <div className="p-axis"><span>start</span><span>drag the chart to scrub</span><span>finish</span></div>
        </>
      )}
      {v === "C" && (
        <>
          <div className="p-lens" role="tablist">
            <button role="tab" aria-selected={tab === "gap"} onClick={() => setTab("gap")}>Gap</button>
            <button role="tab" aria-selected={tab === "race"} onClick={() => { setTab("race"); race.play(); }}>Race</button>
          </div>
          {tab === "gap" ? (
            <>
              {cap}
              <GapChart g={g} lead={L} />
            </>
          ) : (
            <>
              <RaceCap g={g} lead={L} race={race} />
              <Lanes g={g} lead={L} race={race} />
            </>
          )}
        </>
      )}
      {v === "D" && (
        <>
          {cap}
          <RaceCap g={g} lead={L} race={race} />
          <GapChart g={g} lead={L} race={race} ride />
          <div className="p-axis"><span>start</span><span>gold: the leader, on the line</span><span>finish</span></div>
        </>
      )}
      {v === "E" && (
        <div className="p-duo">
          <div>
            <RaceCap g={g} lead={L} race={race} />
            <Lanes g={g} lead={L} race={race} />
          </div>
          <div>
            {cap}
            <GapChart g={g} lead={L} race={race} />
          </div>
        </div>
      )}
      <Stats g={g} />
    </div>
  );
}

const NSEC = 8;
function sectors(a: Ghost) {
  const per = a.at.length / NSEC;
  return Array.from({ length: NSEC }, (_, k) => a.at[(k + 1) * per - 1] - (k ? a.at[k * per - 1] : 0));
}
function SectorPic({ g, lead, c }: { g: Ghost; lead: Ghost | null; c: Ctx }) {
  const mine = sectors(g);
  const theirs = lead ? sectors(lead) : null;
  const field = Object.values(c.data?.[c.board]?.entries ?? {}).map(sectors);
  const best = mine.map((_, k) => Math.min(...field.map((f) => f[k])));
  return (
    <>
      <p className="p-cap">Eight equal stretches of the course, against the leader · <i className="p-sw p-sw-best" /> fastest of the top 50</p>
      <div className="p-sectors">
        {mine.map((s, k) => {
          const d = theirs ? s - theirs[k] : 0;
          const cls = Math.abs(s - best[k]) < 0.0005 ? "p-best-s" : !theirs ? "" : d <= 0 ? "p-up" : "p-down";
          return (
            <div key={k} className={"p-sec " + cls}>
              <small>S{k + 1}</small>
              <b>{s.toFixed(2)}</b>
              {theirs && <span>{signed(d)}</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

const NONE = <span className="p-none">no replay read</span>;

/* ---------- what each variant adds to a row ---------- */

/* A and B: a line under the name. Returns null when the variant draws nothing there. */
export function RowLine({ id }: { id: string }) {
  const c = useProto();
  if (ROUND !== 1 || !c || !c.data) return null;
  const g = ghostOf(c, id);
  if (c.variant === "A")
    return (
      <span className="p-chips">
        {g ? (
          <>
            <i>{kmh(g.avg)}</i>
            <i>top {g.top.toFixed(0)}</i>
            <i>{g.dist.toFixed(0)} m</i>
            <i title={g.set ?? ""}>{ago(g.set)}</i>
            {g.hat && <i>{g.hat}</i>}
          </>
        ) : (
          NONE
        )}
      </span>
    );
  if (c.variant === "B")
    return <span className="p-bline">{g ? `${kmh(g.avg)} avg · ${g.top.toFixed(0)} top · ${day(g.set)}` : NONE}</span>;
  return null;
}

/* B: the extra desktop columns */
export function RowCols({ id }: { id: string }) {
  const c = useProto();
  if (ROUND !== 1 || c?.variant !== "B" || !c.data) return null;
  const g = ghostOf(c, id);
  return (
    <>
      <span className="p-col">{g ? g.avg.toFixed(1) : "–"}</span>
      <span className="p-col">{g ? g.top.toFixed(0) : "–"}</span>
      <span className="p-col p-dim">{g ? day(g.set) : "–"}</span>
    </>
  );
}
export function HeadCols() {
  const c = useProto();
  if (ROUND !== 1 || c?.variant !== "B") return null;
  return (
    <>
      <span className="p-col">Avg km/h</span>
      <span className="p-col">Top</span>
      <span className="p-col">Set</span>
    </>
  );
}

/* D: what the score column shows under the lens; null keeps the time */
export function LensScore({ id }: { id: string }) {
  const c = useProto();
  if (ROUND !== 1 || c?.variant !== "D" || c.lens === "time" || !c.data) return null;
  const g = ghostOf(c, id);
  if (!g) return <span className="p-none">–</span>;
  const all = Object.values(c.data[c.board]?.entries ?? {});
  const v = { avg: g.avg, top: g.top, dist: g.dist, set: 0, time: 0 }[c.lens];
  const best =
    c.lens === "dist" ? Math.min(...all.map((x) => x.dist)) : c.lens === "set" ? 0 : Math.max(...all.map((x) => x[c.lens as "avg" | "top"]));
  const txt = c.lens === "set" ? day(g.set) : c.lens === "dist" ? `${g.dist.toFixed(0)} m` : kmh(v);
  return <span className={v === best ? "p-best" : ""}>{txt}</span>;
}

/* E: a thin speed bar under the row */
export function SpeedBar({ id }: { id: string }) {
  const c = useProto();
  if (ROUND !== 1 || c?.variant !== "E" || !c.data) return null;
  const g = ghostOf(c, id);
  if (!g) return null;
  const all = Object.values(c.data[c.board]?.entries ?? {});
  const lo = Math.min(...all.map((x) => x.avg)) * 0.97;
  const hi = Math.max(...all.map((x) => x.avg));
  return <i className="p-bar" style={{ width: `${(((g.avg - lo) / (hi - lo)) * 100).toFixed(1)}%` }} />;
}

/* C: the drawer under an open row */
export function Drawer({ id }: { id: string }) {
  const c = useProto();
  if ((ROUND === 1 && c?.variant !== "C") || !c || c.open !== id || !c.data) return null;
  const g = ghostOf(c, id);
  return <div className="p-drawer">{g ? <Detail g={g} c={c} /> : <p className="p-cap">No replay read for this run. Only the top {c.data[c.board]?.top ?? 50} are read.</p>}</div>;
}

/* C and E open on a row tap */
export function rowClick(c: Ctx | null, id: string) {
  if (!c || (ROUND === 1 && c.variant !== "C" && c.variant !== "E")) return undefined;
  return (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) return;
    c.setOpen(c.open === id ? null : id);
  };
}

/* D: the switch over the board */
export function LensBar() {
  const c = useProto();
  if (ROUND !== 1 || c?.variant !== "D") return null;
  const opts: Array<[Lens, string]> = [
    ["time", "Time"],
    ["avg", "Avg speed"],
    ["top", "Top speed"],
    ["dist", "Distance"],
    ["set", "Set on"],
  ];
  return (
    <div className="p-lens" role="tablist">
      {opts.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={c.lens === k} onClick={() => c.setLens(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/* E: the run card */
function RunCard() {
  const c = useProto();
  if (!c?.open || !c.data) return null;
  const g = ghostOf(c, c.open);
  const row = document.querySelector(`.row[data-id="${c.open}"] .nm`)?.textContent ?? "";
  return (
    <aside className="p-card">
      <button className="p-x" onClick={() => c.setOpen(null)} aria-label="Close">×</button>
      <h3>{row}</h3>
      {g ? <Detail g={g} c={c} /> : <p className="p-cap">No replay read for this run.</p>}
    </aside>
  );
}

/* ---------- the picker: plainly not part of the design ---------- */
function Picker({ variant }: { variant: Variant }) {
  const ref = useRef<HTMLDivElement>(null);
  const i = VARIANTS.findIndex((v) => v.key === variant);
  const go = (d: number) => {
    const v = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length];
    const u = new URL(location.href);
    u.searchParams.set("variant", v.key);
    history.replaceState(history.state, "", u);
    dispatchEvent(new Event("proto-variant"));
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input,textarea")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  useEffect(() => {
    const el = ref.current!;
    let sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      drag = true; sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      el.style.left = `${ox + e.clientX - sx}px`; el.style.top = `${oy + e.clientY - sy}px`;
      el.style.right = "auto"; el.style.bottom = "auto";
    };
    const up = () => { drag = false; };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
    return () => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
  }, []);
  const v = VARIANTS[i];
  return (
    <div className="p-picker" ref={ref}>
      <button onClick={() => go(-1)} aria-label="Previous variant">←</button>
      <div>
        <b>{v.key} · {v.name}</b>
        <small>{v.note}</small>
      </div>
      <button onClick={() => go(1)} aria-label="Next variant">→</button>
    </div>
  );
}

const CSS = `
.p-picker{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:10px;align-items:center;max-width:min(420px,calc(100vw - 32px));padding:8px 10px;border-radius:999px;background:#fff;color:#000;font:600 13px/1.25 system-ui;box-shadow:0 6px 30px rgba(0,0,0,.6);cursor:grab;touch-action:none}
.p-picker small{display:block;font-weight:400;font-size:11px;opacity:.7}
.p-picker button{all:unset;cursor:pointer;width:30px;height:30px;border-radius:50%;background:#000;color:#fff;text-align:center;line-height:30px;flex:none}
.p-none{color:var(--faint);font-size:11px;font-style:italic}
.p-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.p-chips i{font:500 11px/1 var(--f-hud);font-style:normal;color:var(--dim);background:var(--surface);border:1px solid var(--line2);border-radius:999px;padding:3px 7px}
.p-chips i:first-child{color:var(--accent);background:var(--accent-soft)}
.p-bline{display:block;font:500 11.5px var(--f-hud);color:var(--dim);margin-top:2px}
.p-col{display:none;font:600 13px var(--f-hud);text-align:right;color:var(--text)}
.p-dim{color:var(--dim)}
.p-best{color:var(--accent)}
.p-lens{display:flex;gap:4px;overflow-x:auto;margin:0 0 10px;padding:3px;border-radius:999px;background:var(--surface);border:1px solid var(--line2);width:max-content;max-width:100%}
.p-lens button{all:unset;cursor:pointer;padding:6px 12px;border-radius:999px;font:600 12px var(--f-hud);color:var(--dim);white-space:nowrap}
.p-lens button[aria-selected=true]{background:var(--accent);color:var(--accent-ink)}
.row.p-tap{cursor:pointer}
.row.p-open{background:var(--surface2)}
.p-drawer{grid-column:1/-1;padding:12px 0 6px}
.p-detail{display:flex;gap:14px;align-items:flex-start}
.p-detail-main{flex:1;min-width:0}
.p-route{flex:none;background:var(--solid);border:1px solid var(--line2);border-radius:var(--radius)}
.p-route polyline{fill:none;stroke-linejoin:round;stroke-linecap:round}
.p-route-lead{stroke:var(--gold);stroke-width:1.4;stroke-dasharray:3 3;opacity:.8}
.p-route-me{stroke:hsl(var(--h,100) 80% 64%);stroke-width:2}
.p-route-start{fill:var(--text)}
.p-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px 12px;margin:0}
.p-stats dt{font:600 10px var(--f-hud);letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.p-stats dd{margin:2px 0 0;font:600 14px var(--f-hud);color:var(--text)}
.p-cap{font-size:12px;color:var(--dim);margin:12px 0 4px}
.p-gap polyline{fill:none;stroke:var(--a);stroke-width:2;vector-effect:non-scaling-stroke}
.p-gap-zero{stroke:var(--gold);stroke-dasharray:3 3;opacity:.6;vector-effect:non-scaling-stroke}
.p-bar{position:absolute;left:0;bottom:0;height:2px;background:linear-gradient(90deg,transparent,var(--accent));opacity:.7;pointer-events:none}
.board .row{position:relative}
.p-card{position:fixed;z-index:50;left:0;right:0;bottom:0;max-height:70vh;overflow:auto;padding:16px;background:var(--solid);border-top:1px solid var(--line);border-radius:16px 16px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.5)}
.p-card h3{margin:0 0 12px;font:700 18px var(--f-hud);color:var(--text)}
.p-card .p-detail{flex-direction:column}
.p-card .p-route{width:100%;height:auto;max-width:320px}
.p-x{all:unset;cursor:pointer;position:absolute;right:14px;top:10px;font-size:22px;color:var(--dim)}
@media (max-width:899px){.p-detail{flex-direction:column}.p-route{width:100%;height:auto;max-width:260px}}
@media (min-width:900px){
 .p-v-B .board .row,.p-v-B .board .head{grid-template-columns:48px 26px minmax(160px,1fr) 80px 56px 64px 176px}
 .p-v-B .p-col{display:block}
 .p-v-B .p-bline{display:none}
 .p-card{left:auto;top:90px;bottom:auto;right:24px;width:340px;max-height:calc(100vh - 120px);border:1px solid var(--line);border-radius:var(--radius)}
}
.p-pic{display:flex;flex-direction:column;gap:6px}
.p-pic .p-stats{margin-top:10px}
.p-pic .p-cap{margin:0 0 4px}
.p-pic .p-cap b{color:var(--text)}
.p-chart{width:100%;height:auto;aspect-ratio:600/100;max-height:140px;background:var(--solid);border:1px solid var(--line2);border-radius:var(--radius)}
.p-chart polyline{fill:none;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.p-ln-me{stroke:hsl(var(--h,100) 80% 64%);stroke-width:2.5}
.p-ln-lead{stroke:var(--gold);stroke-width:1.5;stroke-dasharray:5 4;opacity:.85}
.p-zero{stroke:var(--gold);stroke-dasharray:4 4;opacity:.6;vector-effect:non-scaling-stroke}
.p-hot{fill:var(--a-soft)}
.p-fast{fill:var(--accent-soft)}
.p-slow{fill:var(--a-soft)}
.p-ground{fill:var(--surface2)}
.p-dot{fill:var(--text)}
.p-axis{display:flex;justify-content:space-between;font:500 10.5px var(--f-hud);color:var(--faint)}
.p-key{display:inline-block;width:40px;height:6px;border-radius:3px;vertical-align:middle;background:linear-gradient(90deg,hsl(200 90% 60%),hsl(100 90% 60%),hsl(0 90% 60%))}
.p-race{display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:var(--solid);border:1px solid var(--line2);border-radius:var(--radius)}
.p-lane{position:relative;height:26px;margin-right:22px;border-bottom:2px dashed var(--line)}
.p-lane-name{position:absolute;left:0;top:-2px;font:600 10px var(--f-hud);text-transform:uppercase;letter-spacing:.06em;color:var(--faint)}
.p-mb{position:absolute;bottom:-11px;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 34% 27%,hsl(var(--h,100) 94% 90%),hsl(var(--h,100) 80% 64%) 34%,hsl(var(--h,100) 62% 25%))}
.p-mb-lead{background:radial-gradient(circle at 34% 27%,#fff6c8,var(--gold) 34%,#7a5a00)}
.p-btn{all:unset;cursor:pointer;align-self:flex-start;padding:6px 14px;border-radius:999px;background:var(--surface2);font:600 12px var(--f-hud);color:var(--text)}
.p-sectors{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
@media (min-width:900px){.p-sectors{grid-template-columns:repeat(8,1fr)}}
.p-sec{display:flex;flex-direction:column;gap:2px;padding:8px;border-radius:8px;background:var(--surface);border:1px solid var(--line2);font-family:var(--f-hud)}
.p-sec small{font-size:10px;color:var(--faint)}
.p-sec b{font-size:14px;color:var(--text)}
.p-sec span{font-size:11px;color:var(--dim)}
.p-up{background:var(--accent-soft)}.p-up span{color:var(--accent)}
.p-down{background:var(--a-soft)}.p-down span{color:var(--a)}
.p-best-s{background:rgba(180,120,255,.18);border-color:rgba(180,120,255,.5)}
.p-sw{display:inline-block;width:10px;height:10px;border-radius:3px;vertical-align:-1px}
.p-sw-best{background:rgba(180,120,255,.6)}

.p-gapbox{position:relative}
.p-gapbox.p-scrub{cursor:ew-resize;touch-action:none}
.p-on{position:absolute;left:8px;font:600 10px var(--f-hud);letter-spacing:.06em;text-transform:uppercase;color:var(--faint);pointer-events:none}
.p-on-up{bottom:calc(50% + 3px)}
.p-on-dn{top:calc(50% + 3px)}
.p-head{stroke:var(--text);stroke-width:1.5;opacity:.7;vector-effect:non-scaling-stroke}
.p-ride{transform:translate(-50%,-50%);bottom:auto}
.p-racecap{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dim)}
.p-racecap b{color:var(--text)}
.p-racecap .p-btn{margin-left:auto}
.p-duo{display:grid;gap:12px}
@media (min-width:900px){.p-duo{grid-template-columns:2fr 3fr;align-items:end}}
`;
// ===================== end PROTOTYPE =====================
