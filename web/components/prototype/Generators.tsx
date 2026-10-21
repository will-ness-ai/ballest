"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: grill-design for the Prefab generators (claude/prototype-prefab-generators).
// Never merged: the winner is rebuilt by /implement-spec. /prefabs/make draws the variant
// ?variant= names; ProtoPicker (in the layout) cycles them and frames the phone view.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { PrefabViewer } from "../prefabs/PrefabViewer";
import type { PrefabFile } from "../../lib/prefab";
import { newPrefabHref, prefabsHref } from "../../lib/routes";
import {
  COLOURS,
  PIECE_LIMIT,
  SWATCH,
  qrGrid,
  textGrid,
  wallOf,
  type Colour,
  type Grid,
} from "./gen";

/* ---------- the variant switch ---------- */
const VARIANTS = [
  ["A", "Tabs + side preview"],
  ["B", "Pick a generator, then edit"],
  ["C", "A source on the upload form"],
  ["D", "Full-screen model, floating panel"],
  ["E", "Flat pattern first"],
] as const;
type VariantKey = (typeof VARIANTS)[number][0];

const listeners = new Set<() => void>();
const subscribe = (f: () => void) => {
  listeners.add(f);
  addEventListener("popstate", f);
  return () => {
    listeners.delete(f);
    removeEventListener("popstate", f);
  };
};
const emit = () => listeners.forEach((f) => f());
const param = (k: string) => new URLSearchParams(location.search).get(k);
const setParam = (k: string, v: string | null) => {
  const q = new URLSearchParams(location.search);
  if (v === null) q.delete(k);
  else q.set(k, v);
  history.replaceState(history.state, "", location.pathname + "?" + q.toString());
  emit();
};

function useParam(k: string) {
  return useSyncExternalStore(
    subscribe,
    () => param(k),
    () => null,
  );
}
function useVariant(): VariantKey {
  const v = useParam("variant");
  return VARIANTS.find((x) => x[0] === v)?.[0] ?? "A";
}

/* ---------- the generators' shared state ---------- */
type Kind = "qr" | "text";
interface Gen {
  kind: Kind;
  setKind: (k: Kind) => void;
  qr: string;
  setQr: (s: string) => void;
  text: string;
  setText: (s: string) => void;
  cols: number;
  setCols: (n: number) => void;
  rows: number;
  setRows: (n: number) => void;
  cell: number;
  setCell: (n: number) => void;
  back: Colour;
  setBack: (c: Colour) => void;
  front: Colour;
  setFront: (c: Colour) => void;
  grid: Grid | null;
  file: PrefabFile | null;
  fits: boolean;
  pieces: number;
  size: { w: number; h: number };
}

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function useGen(): Gen {
  const k = useParam("gen");
  const kind: Kind = k === "text" ? "text" : "qr";
  const setKind = (x: Kind) => setParam("gen", x);
  const [qr, setQr] = useState("https://ballest.willness.dev");
  const [text, setText] = useState("Welcome to my map");
  const [cols, setCols] = useState(60);
  const [rows, setRows] = useState(20);
  const [cell, setCell] = useState(20);
  const [back, setBack] = useState<Colour>("White");
  const [front, setFront] = useState<Colour>("Dark");
  const dq = useDebounced(qr);
  const dt = useDebounced(text);
  const layout = useMemo(() => {
    if (kind === "qr") {
      const g = qrGrid(dq);
      return { grid: g, fits: !!g };
    }
    const t = textGrid(dt, cols, rows);
    return { grid: t.grid, fits: t.fits };
  }, [kind, dq, dt, cols, rows]);
  const file = useMemo(
    () => (layout.grid ? wallOf(layout.grid, cell, back, front) : null),
    [layout.grid, cell, back, front],
  );
  const pieces = file?.items.length ?? 0;
  const size = layout.grid
    ? { w: (layout.grid.w * cell) / 100, h: (layout.grid.h * cell) / 100 }
    : { w: 0, h: 0 };
  return {
    kind,
    setKind,
    qr,
    setQr,
    text,
    setText,
    cols,
    setCols,
    rows,
    setRows,
    cell,
    setCell,
    back,
    setBack,
    front,
    setFront,
    grid: layout.grid,
    file,
    fits: layout.fits,
    pieces,
    size,
  };
}

const metres = (m: number) => (m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "")) + " m";

/* ---------- shared pieces ---------- */
function download(g: Gen) {
  if (!g.file) return;
  const blob = new Blob([JSON.stringify(g.file, null, "\t")], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = g.kind === "qr" ? "qr_code.json" : "text_wall.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function Preview({ g, className = "pg-view" }: { g: Gen; className?: string }) {
  return (
    <div className={className}>
      {g.file ? (
        <PrefabViewer key={JSON.stringify(g.grid?.w) + g.kind} file={g.file} spin={false} />
      ) : (
        <p className="pg-empty">
          {g.kind === "qr" ? "Type something to encode." : "Type some text."}
        </p>
      )}
    </div>
  );
}

function Flat({ g, className = "pg-flat" }: { g: Gen; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !g.grid) return;
    const { w, h, on } = g.grid;
    const px = Math.max(1, Math.floor(900 / Math.max(w, h)));
    c.width = w * px;
    c.height = h * px;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = SWATCH[g.back];
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = SWATCH[g.front];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (on(x, y)) ctx.fillRect(x * px, y * px, px, px);
  }, [g.grid, g.back, g.front]);
  return (
    <div className={className}>
      {g.grid ? <canvas ref={ref} /> : <p className="pg-empty">Nothing to draw yet.</p>}
    </div>
  );
}

function Stats({ g }: { g: Gen }) {
  const over = g.pieces > PIECE_LIMIT;
  return (
    <p className="pg-stats">
      <span>
        <b>{metres(g.size.w)}</b> × <b>{metres(g.size.h)}</b>
      </span>
      <span className={over ? "pg-bad" : undefined}>
        <b>{g.pieces.toLocaleString()}</b> pieces{over ? ` (the game takes ${PIECE_LIMIT})` : ""}
      </span>
      {g.kind === "text" && !g.fits ? (
        <span className="pg-bad">The text doesn&apos;t fit</span>
      ) : null}
    </p>
  );
}

function Actions({ g }: { g: Gen }) {
  const ok = !!g.file && g.pieces <= PIECE_LIMIT;
  return (
    <div className="pg-actions">
      <button type="button" className="pf-dl" disabled={!ok} onClick={() => download(g)}>
        Download
      </button>
      <Link
        className="pg-ghost"
        href={newPrefabHref()}
        title="PROTOTYPE: would open the upload form with this file"
      >
        Upload to the gallery
      </Link>
    </div>
  );
}

function Swatches({
  label,
  value,
  set,
}: {
  label: string;
  value: Colour;
  set: (c: Colour) => void;
}) {
  return (
    <fieldset className="pg-sw">
      <legend>{label}</legend>
      {COLOURS.map(([c]) => (
        <button
          key={c}
          type="button"
          aria-pressed={value === c}
          title={c}
          style={{ background: SWATCH[c] }}
          onClick={() => set(c)}
        />
      ))}
    </fieldset>
  );
}

function Num({
  label,
  value,
  set,
  min,
  max,
  unit,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  min: number;
  max: number;
  unit?: string;
}) {
  return (
    <label className="pg-num">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set(Math.max(min, Math.min(max, Math.round(n))));
        }}
      />
      {unit ? <small>{unit}</small> : null}
    </label>
  );
}

function Fields({ g, compact = false }: { g: Gen; compact?: boolean }) {
  return (
    <div className={compact ? "pg-fields compact" : "pg-fields"}>
      {g.kind === "qr" ? (
        <label className="pg-txt">
          <span>Link or text</span>
          <input value={g.qr} onChange={(e) => g.setQr(e.target.value)} placeholder="https://…" />
        </label>
      ) : (
        <>
          <label className="pg-txt">
            <span>Text</span>
            <textarea
              rows={compact ? 2 : 3}
              value={g.text}
              onChange={(e) => g.setText(e.target.value)}
            />
          </label>
          <div className="pg-row">
            <Num label="Width" value={g.cols} set={g.setCols} min={8} max={400} unit="blocks" />
            <Num label="Height" value={g.rows} set={g.setRows} min={9} max={200} unit="blocks" />
          </div>
        </>
      )}
      <div className="pg-row">
        <Num label="Block size" value={g.cell} set={g.setCell} min={5} max={200} unit="cm" />
      </div>
      <Swatches label={g.kind === "qr" ? "Background" : "Wall"} value={g.back} set={g.setBack} />
      <Swatches label={g.kind === "qr" ? "Code" : "Letters"} value={g.front} set={g.setFront} />
    </div>
  );
}

function KindTabs({ g, className = "pg-tabs" }: { g: Gen; className?: string }) {
  return (
    <div className={className} role="tablist">
      {(
        [
          ["qr", "QR code"],
          ["text", "Wall of text"],
        ] as const
      ).map(([k, name]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={g.kind === k}
          onClick={() => g.setKind(k)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function Head({ title = "Make a prefab", sub }: { title?: string; sub?: string }) {
  return (
    <header className="pfl-head">
      <div>
        <h1>{title}</h1>
        <p>{sub ?? "Generate a prefab from a link or some text, then download it or share it."}</p>
      </div>
      <Link className="pg-ghost" href={prefabsHref()}>
        All prefabs
      </Link>
    </header>
  );
}

/* ---------- the variants ---------- */
function VariantA({ g }: { g: Gen }) {
  return (
    <section className="pg pgA">
      <Head />
      <KindTabs g={g} />
      <div className="pgA-split">
        <div className="pgA-form">
          <Fields g={g} />
        </div>
        <div className="pgA-side">
          <Preview g={g} />
          <Stats g={g} />
          <Actions g={g} />
        </div>
      </div>
    </section>
  );
}

function VariantB({ g }: { g: Gen }) {
  const open = useParam("open") === "1";
  if (!open)
    return (
      <section className="pg pgB">
        <Head
          title="Prefab generators"
          sub="Pick one to make a prefab you can download or share."
        />
        <div className="pgB-cards">
          {(
            [
              ["qr", "QR code", "A scannable code from a link or text, built out of blocks."],
              [
                "text",
                "Wall of text",
                "Your words in block letters on a wall the size you choose.",
              ],
            ] as const
          ).map(([k, name, blurb]) => (
            <button
              key={k}
              type="button"
              className="pgB-card"
              onClick={() => {
                g.setKind(k);
                setParam("open", "1");
              }}
            >
              <span className={"pgB-art " + k} aria-hidden />
              <b>{name}</b>
              <small>{blurb}</small>
            </button>
          ))}
        </div>
      </section>
    );
  return (
    <section className="pg pgB">
      <button type="button" className="pgB-back" onClick={() => setParam("open", null)}>
        ← Generators
      </button>
      <h1 className="pgB-h">{g.kind === "qr" ? "QR code" : "Wall of text"}</h1>
      <Preview g={g} className="pg-view wide" />
      <div className="pgB-under">
        <Fields g={g} />
        <div className="pgB-act">
          <Stats g={g} />
          <Actions g={g} />
        </div>
      </div>
    </section>
  );
}

function VariantC({ g }: { g: Gen }) {
  const [src, setSrc] = useState<"file" | Kind>(g.kind);
  useEffect(() => {
    if (src !== "file") g.setKind(src);
  }, [src]);
  return (
    <section className="pfu pg pgC">
      <header className="pfl-head">
        <div>
          <h1>Upload a prefab</h1>
          <p>
            Share a prefab you saved in the level editor, or make one here. It goes live as soon as
            you publish.
          </p>
        </div>
      </header>
      <div className="pgC-src" role="radiogroup" aria-label="Where it comes from">
        {(
          [
            ["file", "My file"],
            ["qr", "Make a QR code"],
            ["text", "Make a wall of text"],
          ] as const
        ).map(([k, name]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={src === k}
            onClick={() => setSrc(k)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="pgA-split">
        <div className="pgA-form">
          {src === "file" ? (
            <div className="pfu-drop">
              <b>Choose a prefab file</b>
              <small>or drop it here (PROTOTYPE: the real form)</small>
            </div>
          ) : (
            <Fields g={g} />
          )}
          <h2 className="pfu-h2">About it</h2>
          <label className="pg-txt">
            <span>Name</span>
            <input defaultValue={g.kind === "qr" ? "QR code" : "Welcome sign"} />
          </label>
          <label className="pg-txt">
            <span>Description</span>
            <textarea rows={2} />
          </label>
          <button type="button" className="pf-dl" disabled>
            Publish
          </button>
          <small className="pg-note">
            Moves: the generated file's Download sits under the preview.
          </small>
        </div>
        <div className="pgA-side">
          {src === "file" ? <div className="pg-view" /> : <Preview g={g} />}
          {src === "file" ? null : (
            <>
              <Stats g={g} />
              <button type="button" className="pg-ghost" onClick={() => download(g)}>
                Download instead
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function VariantD({ g }: { g: Gen }) {
  const [hide, setHide] = useState(false);
  return (
    <section className="pg pgD">
      <Preview g={g} className="pg-view full" />
      <div className="pgD-top">
        <KindTabs g={g} className="pg-tabs pill" />
      </div>
      <div className={hide ? "pgD-panel hidden" : "pgD-panel"}>
        <div className="pgD-ph">
          <b>{g.kind === "qr" ? "QR code" : "Wall of text"}</b>
          <button type="button" className="pg-ghost" onClick={() => setHide(!hide)}>
            {hide ? "Show" : "Hide"}
          </button>
        </div>
        {hide ? null : (
          <>
            <Fields g={g} compact />
            <Stats g={g} />
            <Actions g={g} />
          </>
        )}
      </div>
      <small className="pg-note pgD-note">Moves: no page heading; the model is the page.</small>
    </section>
  );
}

function VariantE({ g }: { g: Gen }) {
  const [three, setThree] = useState(false);
  return (
    <section className="pg pgE">
      <Head />
      <div className="pgE-bar">
        <KindTabs g={g} />
        <Stats g={g} />
        <Actions g={g} />
      </div>
      <div className="pgE-main">
        <aside className="pgE-tools">
          <Fields g={g} compact />
        </aside>
        <div className="pgE-stage">
          {three ? (
            <Preview g={g} className="pg-view tall" />
          ) : (
            <Flat g={g} className="pg-flat tall" />
          )}
          <div className="pgE-toggle" role="group" aria-label="View">
            <button type="button" aria-pressed={!three} onClick={() => setThree(false)}>
              Flat
            </button>
            <button type="button" aria-pressed={three} onClick={() => setThree(true)}>
              3D
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Generators() {
  const v = useVariant();
  const g = useGen();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return v === "A" ? (
    <VariantA g={g} />
  ) : v === "B" ? (
    <VariantB g={g} />
  ) : v === "C" ? (
    <VariantC g={g} />
  ) : v === "D" ? (
    <VariantD g={g} />
  ) : (
    <VariantE g={g} />
  );
}

/* ---------- the variant picker ---------- */
export function ProtoPicker() {
  const vp = useParam("variant");
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const v = useVariant();
  const go = (d: number) => {
    const i = VARIANTS.findIndex((x) => x[0] === v);
    setParam("variant", VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length][0]);
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, dialog")) return;
      if (e.key === "ArrowLeft") goRef.current(-1);
      if (e.key === "ArrowRight") goRef.current(1);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  const view = useParam("view");
  const framed = useSyncExternalStore(
    subscribe,
    () => window.top !== window || param("framed") === "1",
    () => true,
  );
  const href = useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search,
    () => "",
  );
  const path = useSyncExternalStore(
    subscribe,
    () => location.pathname,
    () => "",
  );
  if (framed || (!vp && path !== "/prefabs/make")) return null;
  const label = VARIANTS.find((x) => x[0] === v)?.[1];
  const phone = view === "phone";
  const inner = (() => {
    const [p, query = ""] = href.split("?");
    const q = new URLSearchParams(query);
    q.delete("view");
    q.set("framed", "1");
    return p + "?" + q.toString();
  })();
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (m: PointerEvent) => setPos({ x: m.clientX - dx, y: m.clientY - dy });
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  return (
    <>
      {phone ? (
        <div className="proto-frame">
          <iframe key={inner} src={inner} title="Phone view" />
        </div>
      ) : null}
      <div
        ref={ref}
        className="proto-picker"
        onPointerDown={drag}
        style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      >
        <div className="pp-row">
          <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
            ←
          </button>
          <b>
            {v} · {label}
          </b>
          <button type="button" onClick={() => go(1)} aria-label="Next variant">
            →
          </button>
        </div>
        <div className="pp-row">
          <button type="button" aria-pressed={!phone} onClick={() => setParam("view", null)}>
            Desktop
          </button>
          <button type="button" aria-pressed={phone} onClick={() => setParam("view", "phone")}>
            Phone
          </button>
        </div>
      </div>
    </>
  );
}
