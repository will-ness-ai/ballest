"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: grill-design for the Prefab generators (claude/prototype-prefab-generators).
// Never merged: the winner is rebuilt by /implement-spec. /prefabs/make is the gallery of
// generators (round 2's C, a tab beside the shared prefabs); ?gen=<key> opens one generator in
// round 1's A (controls left, model right). Round 3: ?variant= picks how trees and bushes are
// built (nature.ts). ProtoPicker (in the layout) cycles the variants, switches Tree and Bush
// and frames the phone view.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { PrefabViewer } from "../prefabs/PrefabViewer";
import { stillOf } from "../prefabs/scene";
import { footprintOf, shapesOf, type PrefabFile } from "../../lib/prefab";
import { prefabsHref } from "../../lib/routes";
import {
  COLOURS,
  PIECE_LIMIT,
  SWATCH,
  FONTS,
  qrFile,
  signFile,
  type Colour,
  type QrSettings,
  type SignSettings,
} from "./gen";
import { STYLES, type Ctl, type Vals } from "./nature";

/* ---------- the variant switch ---------- */
const VARIANTS = [
  ["A", "Cloud of balls"],
  ["B", "Branches"],
  ["C", "Tiers and topiary"],
  ["D", "Faceted blocks"],
  ["E", "Voxel"],
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

/* ---------- the generators ---------- */
type GenKey = "qr" | "sign" | "tree" | "bush";
interface Settings {
  qr: QrSettings;
  sign: SignSettings;
  nature: Record<VariantKey, { tree: Vals; bush: Vals }>;
}
const DEFAULTS: Settings = {
  qr: { text: "https://ballestrecords.com", size: 6, back: "White", front: "Dark" },
  sign: {
    text: "Welcome to my map",
    width: 12,
    height: 4,
    wall: true,
    back: "White",
    front: "Dark",
    font: "Pixel",
    detail: 14,
  },
  nature: Object.fromEntries(
    VARIANTS.map(([k]) => [
      k,
      { tree: { ...STYLES[k].tree.defaults }, bush: { ...STYLES[k].bush.defaults } },
    ]),
  ) as Settings["nature"],
};
const GENS: ReadonlyArray<{
  key: GenKey;
  name: string;
  group: "Signs" | "Nature";
  blurb: string;
  changes: Array<string>;
}> = [
  {
    key: "qr",
    name: "QR code",
    group: "Signs",
    blurb: "A code players can scan, built from blocks.",
    changes: ["Link or text", "Size", "Colours"],
  },
  {
    key: "sign",
    name: "Sign",
    group: "Signs",
    blurb: "Your words in block letters, on a wall or standing alone.",
    changes: ["Text", "Width and height", "Wall", "Colours"],
  },
  {
    key: "tree",
    name: "Tree",
    group: "Nature",
    blurb: "A tree of any height and shape, in your colours.",
    changes: ["Style", "Height and spread", "Colours", "Shuffle"],
  },
  {
    key: "bush",
    name: "Bush",
    group: "Nature",
    blurb: "Leaves, flowers or a clipped hedge to dress a corner.",
    changes: ["Size", "Clumps", "Colour", "Shuffle"],
  },
];

function fileOf(key: GenKey, s: Settings, v: VariantKey): PrefabFile | null {
  if (key === "qr") return qrFile(s.qr)?.file ?? null;
  if (key === "sign") return signFile(s.sign)?.file ?? null;
  return STYLES[v][key].build(s.nature[v][key]);
}

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

const metres = (m: number) => (m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "")) + " m";

const sizeOf = (file: PrefabFile) => footprintOf(shapesOf(file));

/* ---------- stills for the gallery ---------- */
const stills = new Map<string, Promise<string>>();
function Still({ gen, className = "pgs-still" }: { gen: GenKey; className?: string }) {
  const v = useVariant();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const key = gen + v;
    if (!stills.has(key)) stills.set(key, stillOf(fileOf(gen, DEFAULTS, v)!, 640, 400));
    void stills.get(key)!.then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [gen, v]);
  return <div className={className}>{src ? <img src={src} alt="" /> : null}</div>;
}

/* ---------- controls ---------- */
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
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="pg-num">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && e.target.value !== "") set(Math.max(min, Math.min(max, n)));
        }}
      />
      {unit ? <small>{unit}</small> : null}
    </label>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (b: boolean) => void }) {
  return (
    <label className="pg-toggle">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Seg<T extends string>({
  label,
  value,
  options,
  set,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<T>;
  set: (v: T) => void;
}) {
  return (
    <fieldset className="pg-seg">
      <legend>{label}</legend>
      <div>
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => set(o)}>
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Fields({ gen, s, set }: { gen: GenKey; s: Settings; set: (s: Settings) => void }) {
  if (gen === "qr") {
    const q = s.qr;
    const up = (p: Partial<QrSettings>) => set({ ...s, qr: { ...q, ...p } });
    return (
      <div className="pg-fields">
        <label className="pg-txt">
          <span>Link or text</span>
          <input
            value={q.text}
            onChange={(e) => up({ text: e.target.value })}
            placeholder="https://…"
          />
        </label>
        <Num label="Size" value={q.size} set={(n) => up({ size: n })} min={1} max={60} unit="m" />
        <Swatches label="Background" value={q.back} set={(c) => up({ back: c })} />
        <Swatches label="Code" value={q.front} set={(c) => up({ front: c })} />
      </div>
    );
  }
  if (gen === "sign") {
    const t = s.sign;
    const up = (p: Partial<SignSettings>) => set({ ...s, sign: { ...t, ...p } });
    return (
      <div className="pg-fields">
        <label className="pg-txt">
          <span>Text</span>
          <textarea rows={3} value={t.text} onChange={(e) => up({ text: e.target.value })} />
        </label>
        <div className="pg-row">
          <Num
            label="Width"
            value={t.width}
            set={(n) => up({ width: n })}
            min={1}
            max={200}
            step={0.5}
            unit="m"
          />
          <Num
            label="Height"
            value={t.height}
            set={(n) => up({ height: n })}
            min={0.5}
            max={100}
            step={0.5}
            unit="m"
          />
        </div>
        <fieldset className="pg-fonts">
          <legend>Font</legend>
          {FONTS.map(([name, css]) => (
            <button
              key={name}
              type="button"
              aria-pressed={t.font === name}
              style={css ? { font: css.replace(/^(\d+ )?/, "$1" + "1rem ") } : undefined}
              className={css ? undefined : "pixel"}
              onClick={() => up({ font: name })}
            >
              {name}
            </button>
          ))}
        </fieldset>
        {t.font === "Pixel" ? null : (
          <Num
            label="Detail"
            value={t.detail}
            set={(n) => up({ detail: Math.round(n) })}
            min={5}
            max={40}
            unit="blocks tall"
          />
        )}
        <Toggle label="Wall behind the text" on={t.wall} set={(b) => up({ wall: b })} />
        {t.wall ? <Swatches label="Wall" value={t.back} set={(c) => up({ back: c })} /> : null}
        <Swatches label="Letters" value={t.front} set={(c) => up({ front: c })} />
      </div>
    );
  }
  const v = param("variant") as VariantKey | null;
  const k = VARIANTS.find((x) => x[0] === v)?.[0] ?? "A";
  const vals = s.nature[k][gen];
  const up = (p: Vals) =>
    set({ ...s, nature: { ...s.nature, [k]: { ...s.nature[k], [gen]: { ...vals, ...p } } } });
  return (
    <div className="pg-fields">
      {STYLES[k][gen].ctls.map((c) => (
        <Control key={c.k} c={c} vals={vals} up={up} />
      ))}
    </div>
  );
}

function Control({ c, vals, up }: { c: Ctl; vals: Vals; up: (p: Vals) => void }) {
  const val = vals[c.k];
  if (c.t === "num")
    return (
      <Num
        label={c.label}
        value={Number(val)}
        set={(x) => up({ [c.k]: x })}
        min={c.min}
        max={c.max}
        step={c.step}
        unit={c.unit}
      />
    );
  if (c.t === "colour")
    return <Swatches label={c.label} value={val as Colour} set={(x) => up({ [c.k]: x })} />;
  if (c.t === "toggle") return <Toggle label={c.label} on={!!val} set={(x) => up({ [c.k]: x })} />;
  if (c.t === "seg")
    return (
      <Seg label={c.label} value={String(val)} options={c.opts} set={(x) => up({ [c.k]: x })} />
    );
  return (
    <button
      type="button"
      className="pg-ghost pg-shuffle"
      onClick={() => up({ seed: Math.floor(Math.random() * 1e9) })}
    >
      Shuffle
    </button>
  );
}

function download(gen: GenKey, file: PrefabFile) {
  const blob = new Blob([JSON.stringify(file, null, "\t")], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = { qr: "qr_code", sign: "sign", tree: "tree", bush: "bush" }[gen] + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- one generator: round 1's A ---------- */
function Editor({ gen, s, set }: { gen: GenKey; s: Settings; set: (s: Settings) => void }) {
  const v = useVariant();
  const ds = useDebounced(s);
  /* web fonts arrive after the first draw; draw again once they have */
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    const bump = () => setFonts((n) => n + 1);
    document.fonts.addEventListener("loadingdone", bump);
    void Promise.all(
      FONTS.filter((f) => f[1]).map((f) =>
        document.fonts.load(f[1].replace(/^(\d+ )?/, "$1" + "40px ")),
      ),
    ).then(bump);
    return () => document.fonts.removeEventListener("loadingdone", bump);
  }, []);
  const file = useMemo(() => fileOf(gen, ds, v), [gen, ds, v, fonts]);
  const g = GENS.find((x) => x.key === gen)!;
  const size = file ? sizeOf(file) : null;
  const pieces = file?.items.length ?? 0;
  const over = pieces > PIECE_LIMIT;
  return (
    <section className="pg pgA">
      <header className="pfl-head">
        <div>
          <button type="button" className="pgB-back" onClick={() => setParam("gen", null)}>
            ← All generators
          </button>
          <h1>{g.name}</h1>
          <p>{g.blurb}</p>
        </div>
      </header>
      <div className="pgA-split">
        <div className="pgA-form">
          <Fields gen={gen} s={s} set={set} />
        </div>
        <div className="pgA-side">
          <div className="pg-view">
            {file ? (
              <PrefabViewer file={file} spin={false} />
            ) : (
              <p className="pg-empty">Type something first.</p>
            )}
          </div>
          {size ? (
            <p className="pg-stats">
              <span>
                <b>{metres(size.w)}</b> wide × <b>{metres(size.d)}</b> deep ×{" "}
                <b>{metres(size.h)}</b> tall
              </span>
              <span className={over ? "pg-bad" : undefined}>
                <b>{pieces.toLocaleString()}</b> pieces
                {over ? ` (the game takes ${PIECE_LIMIT})` : ""}
              </span>
            </p>
          ) : null}
          <div className="pg-actions">
            <button
              type="button"
              className="pf-dl"
              disabled={!file || over}
              onClick={() => file && download(gen, file)}
            >
              Download
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- the gallery of generators: round 2 ---------- */
const open = (k: GenKey) => setParam("gen", k);

function Head() {
  return (
    <header className="pfl-head">
      <div>
        <h1>Make a prefab</h1>
        <p>Pick one, change it to suit your map, and download it.</p>
      </div>
      <Link className="pg-ghost" href={prefabsHref()}>
        Shared prefabs
      </Link>
    </header>
  );
}

function GalleryC() {
  return (
    <section className="pg">
      <header className="pfl-head">
        <div>
          <h1>Prefabs</h1>
          <p>
            Ready-made pieces for the level editor. Download one, drop it in your Prefabs folder and
            spawn it into your map.
          </p>
        </div>
      </header>
      <div className="pg-tabs" role="tablist">
        <Link role="tab" aria-selected={false} href={prefabsHref()}>
          Shared by players
        </Link>
        <button type="button" role="tab" aria-selected>
          Make your own
        </button>
      </div>
      <div className="pgs-grid small">
        {GENS.map((g) => (
          <button key={g.key} type="button" className="pgs-card" onClick={() => open(g.key)}>
            <Still gen={g.key} />
            <b>{g.name}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

export function Generators() {
  const v = useVariant();
  const gen = useParam("gen") as GenKey | null;
  const [s, set] = useState<Settings>(DEFAULTS);
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  if (gen && GENS.some((g) => g.key === gen)) return <Editor gen={gen} s={s} set={set} />;
  return <GalleryC />;
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
  const gen = useParam("gen");
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
        <div className="pp-row">
          {(["tree", "bush"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={gen === k}
              onClick={() => setParam("gen", k)}
            >
              {k === "tree" ? "Tree" : "Bush"}
            </button>
          ))}
          <button type="button" aria-pressed={!gen} onClick={() => setParam("gen", null)}>
            Gallery
          </button>
        </div>
      </div>
    </>
  );
}
