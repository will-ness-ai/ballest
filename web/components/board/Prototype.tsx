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
}
type Data = Record<string, { top: number; entries: Record<string, Ghost> }>;

export const VARIANTS = [
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
      {variant === "E" && <RunCard />}
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

const NONE = <span className="p-none">no replay read</span>;

/* ---------- what each variant adds to a row ---------- */

/* A and B: a line under the name. Returns null when the variant draws nothing there. */
export function RowLine({ id }: { id: string }) {
  const c = useProto();
  if (!c || !c.data) return null;
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
  if (c?.variant !== "B" || !c.data) return null;
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
  if (c?.variant !== "B") return null;
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
  if (c?.variant !== "D" || c.lens === "time" || !c.data) return null;
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
  if (c?.variant !== "E" || !c.data) return null;
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
  if (c?.variant !== "C" || c.open !== id || !c.data) return null;
  const g = ghostOf(c, id);
  return <div className="p-drawer">{g ? <Detail g={g} c={c} /> : <p className="p-cap">No replay read for this run. Only the top {c.data[c.board]?.top ?? 50} are read.</p>}</div>;
}

/* C and E open on a row tap */
export function rowClick(c: Ctx | null, id: string) {
  if (!c || (c.variant !== "C" && c.variant !== "E")) return undefined;
  return (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) return;
    c.setOpen(c.open === id ? null : id);
  };
}

/* D: the switch over the board */
export function LensBar() {
  const c = useProto();
  if (c?.variant !== "D") return null;
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
      if ((e.target as HTMLElement).closest("input,textarea")) return;
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
`;
// ===================== end PROTOTYPE =====================
