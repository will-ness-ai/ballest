"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: grill-design for the Prefab generators (claude/prototype-prefab-generators).
// Never merged: the winner is rebuilt by /implement-spec. /prefabs/make is the gallery of
// generators (round 2's C, a tab beside the shared prefabs); ?gen=<key> opens one generator in
// round 1's A (controls left, model right). Trees are round 3's Branches, Tiers or Voxel and
// bushes its Branches (nature.ts). Round 4: ?variant= picks how the controls are laid out,
// sliders in every one. ProtoPicker (in the layout) cycles the variants, switches generator
// and frames the phone view.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { PrefabViewer } from "../prefabs/PrefabViewer";
import { stillOf } from "../prefabs/scene";
import { footprintOf, shapesOf, type PrefabFile } from "../../lib/prefab";
import { prefabsHref } from "../../lib/routes";
import { COLOURS, PIECE_LIMIT, SWATCH, FONTS, qrFile, signFile, type Colour } from "./gen";
import { STYLES, type Ctl, type Vals } from "./nature";

/* ---------- the variant switch ---------- */
const VARIANTS = [
  ["A", "One column of sliders"],
  ["B", "Grouped sections"],
  ["C", "Slider and number, two columns"],
  ["D", "Style cards and palettes"],
  ["E", "Simple, with More options"],
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

/* ---------- the generators, each a list of controls over its values ---------- */
type GenKey = "qr" | "sign" | "tree" | "bush";
type Field =
  | Ctl
  | { k: string; label: string; t: "text"; area?: boolean }
  | { k: string; label: string; t: "font" };
const TREE_STYLES = { Branches: STYLES.B.tree, Tiers: STYLES.C.tree, Voxel: STYLES.E.tree };
type TreeStyle = keyof typeof TREE_STYLES;

const QR_FIELDS: Array<Field> = [
  { k: "text", label: "Link or text", t: "text" },
  { k: "size", label: "Size", t: "num", min: 1, max: 60, step: 0.5, unit: "m" },
  { k: "back", label: "Background", t: "colour" },
  { k: "front", label: "Code", t: "colour" },
];
const SIGN_FIELDS: Array<Field> = [
  { k: "text", label: "Text", t: "text", area: true },
  { k: "font", label: "Font", t: "font" },
  { k: "detail", label: "Detail", t: "num", min: 5, max: 40, unit: "blocks" },
  { k: "width", label: "Width", t: "num", min: 1, max: 100, step: 0.5, unit: "m" },
  { k: "height", label: "Height", t: "num", min: 0.5, max: 50, step: 0.5, unit: "m" },
  { k: "wall", label: "Wall behind the text", t: "toggle" },
  { k: "back", label: "Wall", t: "colour" },
  { k: "front", label: "Letters", t: "colour" },
];

interface Settings {
  qr: Vals;
  sign: Vals;
  treeStyle: TreeStyle;
  tree: Record<TreeStyle, Vals>;
  bush: Vals;
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
  treeStyle: "Branches",
  tree: {
    Branches: { ...TREE_STYLES.Branches.defaults },
    Tiers: { ...TREE_STYLES.Tiers.defaults },
    Voxel: { ...TREE_STYLES.Voxel.defaults },
  },
  bush: { ...STYLES.B.bush.defaults },
};

/* what a generator shows now: its controls (some hidden by others' values), values and setter */
function specOf(gen: GenKey, s: Settings, set: (s: Settings) => void) {
  if (gen === "qr")
    return {
      fields: QR_FIELDS,
      vals: s.qr,
      up: (p: Vals) => set({ ...s, qr: { ...s.qr, ...p } }),
    };
  if (gen === "sign")
    return {
      fields: SIGN_FIELDS.filter(
        (f) => !(f.k === "detail" && s.sign.font === "Pixel") && !(f.k === "back" && !s.sign.wall),
      ),
      vals: s.sign,
      up: (p: Vals) => set({ ...s, sign: { ...s.sign, ...p } }),
    };
  if (gen === "bush")
    return {
      fields: STYLES.B.bush.ctls as Array<Field>,
      vals: s.bush,
      up: (p: Vals) => set({ ...s, bush: { ...s.bush, ...p } }),
    };
  const st = s.treeStyle;
  return {
    fields: TREE_STYLES[st].ctls as Array<Field>,
    vals: s.tree[st],
    up: (p: Vals) => set({ ...s, tree: { ...s.tree, [st]: { ...s.tree[st], ...p } } }),
  };
}

function fileOf(gen: GenKey, s: Settings): PrefabFile | null {
  if (gen === "qr") return qrFile(s.qr as never)?.file ?? null;
  if (gen === "sign") return signFile(s.sign as never)?.file ?? null;
  if (gen === "bush") return STYLES.B.bush.build(s.bush);
  return TREE_STYLES[s.treeStyle].build(s.tree[s.treeStyle]);
}

const GENS: ReadonlyArray<{ key: GenKey; name: string; blurb: string }> = [
  { key: "qr", name: "QR code", blurb: "A code players can scan, built from blocks." },
  { key: "sign", name: "Sign", blurb: "Your words in blocks, on a wall or standing alone." },
  { key: "tree", name: "Tree", blurb: "A branching tree, a tiered pine or a block-game tree." },
  { key: "bush", name: "Bush", blurb: "A shrub of stems with leaf clumps." },
];

/* the sections variant B groups controls into, and the ones variant E shows before More */
const GROUP: Record<string, string> = {
  text: "Content",
  font: "Content",
  detail: "Content",
  species: "Shape",
  height: "Shape",
  width: "Shape",
  size: "Shape",
  tiers: "Shape",
  taper: "Shape",
  overlap: "Shape",
  cell: "Shape",
  radius: "Shape",
  levels: "Branches",
  forks: "Branches",
  angle: "Branches",
  ratio: "Branches",
  stems: "Branches",
  girth: "Trunk",
  stem: "Trunk",
  clump: "Leaves",
  clumpBalls: "Leaves",
  holes: "Leaves",
  snow: "Leaves",
  wall: "Wall",
};
const groupOf = (f: Field) =>
  f.t === "colour" ? "Colours" : f.t === "seed" ? "Shape" : (GROUP[f.k] ?? "Shape");
const BASIC = new Set([
  "text",
  "font",
  "size",
  "height",
  "width",
  "species",
  "tiers",
  "levels",
  "stems",
  "wall",
  "seed",
]);
/* colour pairs variant D offers, laid on a generator's first two colour controls */
const PALETTES: Array<[string, Colour, Colour]> = [
  ["Classic", "White", "Dark"],
  ["Spring", "Copper", "Lime"],
  ["Autumn", "Wine", "Orange"],
  ["Golden", "Gold", "Yellow"],
  ["Night", "Dark", "Lime"],
  ["Winter", "Iron", "White"],
];

function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

const metres = (m: number) => (m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "")) + " m";
const sizeOf = (file: PrefabFile) => footprintOf(shapesOf(file));

/* ---------- stills ---------- */
const stills = new Map<string, Promise<string>>();
function Still({
  id,
  file,
  className = "pgs-still",
}: {
  id: string;
  file: () => PrefabFile | null;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!stills.has(id)) stills.set(id, stillOf(file()!, 640, 400));
    void stills.get(id)!.then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [id]);
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

const fmt = (n: number, step = 1) =>
  step < 1 ? n.toFixed(step < 0.1 ? 2 : 1).replace(/\.?0+$/, "") : String(Math.round(n));

function Slider({
  f,
  value,
  set,
  boxed,
}: {
  f: Extract<Field, { t: "num" }>;
  value: number;
  set: (n: number) => void;
  boxed: boolean;
}) {
  const step = f.step ?? 1;
  const unit = f.unit ? (f.unit === "°" || f.unit === "%" ? f.unit : " " + f.unit) : "";
  return (
    <label className={boxed ? "pg-slide boxed" : "pg-slide"}>
      <span className="pg-slide-top">
        <span>{f.label}</span>
        {boxed ? null : (
          <output>
            {fmt(value, step)}
            {unit}
          </output>
        )}
      </span>
      <span className="pg-slide-row">
        <input
          type="range"
          min={f.min}
          max={f.max}
          step={step}
          value={value}
          style={{ ["--pct" as string]: `${((value - f.min) / (f.max - f.min)) * 100}%` }}
          onChange={(e) => set(Number(e.target.value))}
        />
        {boxed ? (
          <span className="pg-box">
            <input
              type="number"
              min={f.min}
              max={f.max}
              step={step}
              value={value}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (e.target.value !== "" && Number.isFinite(n))
                  set(Math.max(f.min, Math.min(f.max, n)));
              }}
            />
            {f.unit ? <small>{f.unit}</small> : null}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function Seg({
  label,
  value,
  options,
  set,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<string>;
  set: (v: string) => void;
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

function Control({
  f,
  vals,
  up,
  boxed = false,
}: {
  f: Field;
  vals: Vals;
  up: (p: Vals) => void;
  boxed?: boolean;
}) {
  const val = vals[f.k];
  if (f.t === "num")
    return <Slider f={f} value={Number(val)} set={(x) => up({ [f.k]: x })} boxed={boxed} />;
  if (f.t === "colour")
    return <Swatches label={f.label} value={val as Colour} set={(x) => up({ [f.k]: x })} />;
  if (f.t === "toggle")
    return (
      <label className="pg-toggle">
        <input type="checkbox" checked={!!val} onChange={(e) => up({ [f.k]: e.target.checked })} />
        <span>{f.label}</span>
      </label>
    );
  if (f.t === "seg")
    return (
      <Seg label={f.label} value={String(val)} options={f.opts} set={(x) => up({ [f.k]: x })} />
    );
  if (f.t === "text")
    return (
      <label className="pg-txt">
        <span>{f.label}</span>
        {f.area ? (
          <textarea rows={3} value={String(val)} onChange={(e) => up({ [f.k]: e.target.value })} />
        ) : (
          <input value={String(val)} onChange={(e) => up({ [f.k]: e.target.value })} />
        )}
      </label>
    );
  if (f.t === "font")
    return (
      <fieldset className="pg-fonts">
        <legend>{f.label}</legend>
        {FONTS.map(([name, css]) => (
          <button
            key={name}
            type="button"
            aria-pressed={val === name}
            style={css ? { font: css.replace(/^(\d+ )?/, "$1" + "1rem ") } : undefined}
            className={css ? undefined : "pixel"}
            onClick={() => up({ font: name })}
          >
            {name}
          </button>
        ))}
      </fieldset>
    );
  return (
    <button
      type="button"
      className="pg-ghost pg-shuffle"
      onClick={() => up({ seed: Math.floor(Math.random() * 1e9) })}
    >
      ⟳ Shuffle
    </button>
  );
}

/* the tree's style: a segmented control, or (variant D) a card per style with its picture */
function TreeStyles({
  s,
  set,
  cards,
}: {
  s: Settings;
  set: (s: Settings) => void;
  cards: boolean;
}) {
  const styles = Object.keys(TREE_STYLES) as Array<TreeStyle>;
  if (!cards)
    return (
      <Seg
        label="Style"
        value={s.treeStyle}
        options={styles}
        set={(x) => set({ ...s, treeStyle: x as TreeStyle })}
      />
    );
  return (
    <fieldset className="pg-cards">
      <legend>Style</legend>
      {styles.map((st) => (
        <button
          key={st}
          type="button"
          aria-pressed={s.treeStyle === st}
          onClick={() => set({ ...s, treeStyle: st })}
        >
          <Still
            id={"style-" + st}
            file={() => TREE_STYLES[st].build(TREE_STYLES[st].defaults)}
            className="pgs-still"
          />
          <span>{st}</span>
        </button>
      ))}
    </fieldset>
  );
}

/* ---------- round 4: five ways to lay out the controls ---------- */
function Panel({ gen, s, set }: { gen: GenKey; s: Settings; set: (s: Settings) => void }) {
  const v = useVariant();
  const { fields, vals, up } = specOf(gen, s, set);
  const [more, setMore] = useState(false);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const style = gen === "tree" ? <TreeStyles s={s} set={set} cards={v === "D"} /> : null;

  if (v === "B") {
    const groups = [...new Set(fields.map(groupOf))];
    return (
      <div className="pg-fields">
        {style}
        {groups.map((g) => {
          const open = !shut.has(g);
          return (
            <section key={g} className="pg-group">
              <button
                type="button"
                className="pg-group-h"
                aria-expanded={open}
                onClick={() => {
                  const n = new Set(shut);
                  if (open) n.add(g);
                  else n.delete(g);
                  setShut(n);
                }}
              >
                {g}
                <span aria-hidden>{open ? "−" : "+"}</span>
              </button>
              {open ? (
                <div className="pg-group-b">
                  {fields
                    .filter((f) => groupOf(f) === g)
                    .map((f) => (
                      <Control key={f.k} f={f} vals={vals} up={up} />
                    ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    );
  }
  if (v === "C")
    return (
      <div className="pg-fields">
        {style}
        <div className="pg-two">
          {fields.map((f) => (
            <div key={f.k} className={f.t === "num" ? "pg-cell" : "pg-cell wide"}>
              <Control f={f} vals={vals} up={up} boxed />
            </div>
          ))}
        </div>
      </div>
    );
  if (v === "D") {
    const colours = fields.filter((f) => f.t === "colour").slice(0, 2);
    return (
      <div className="pg-fields">
        {style}
        {fields
          .filter((f) => f.t !== "colour")
          .map((f) => (
            <Control key={f.k} f={f} vals={vals} up={up} />
          ))}
        {colours.length === 2 ? (
          <fieldset className="pg-pal">
            <legend>Colours</legend>
            {PALETTES.map(([name, a, b]) => (
              <button
                key={name}
                type="button"
                aria-pressed={vals[colours[0].k] === a && vals[colours[1].k] === b}
                onClick={() => up({ [colours[0].k]: a, [colours[1].k]: b })}
              >
                <span style={{ background: SWATCH[a] }} />
                <span style={{ background: SWATCH[b] }} />
                {name}
              </button>
            ))}
          </fieldset>
        ) : null}
        <details className="pg-more">
          <summary>Pick each colour</summary>
          {fields
            .filter((f) => f.t === "colour")
            .map((f) => (
              <Control key={f.k} f={f} vals={vals} up={up} />
            ))}
        </details>
      </div>
    );
  }
  if (v === "E") {
    const basic = fields.filter(
      (f) =>
        BASIC.has(f.k) ||
        (f.t === "colour" && fields.filter((x) => x.t === "colour").indexOf(f) < 2),
    );
    const rest = fields.filter((f) => !basic.includes(f));
    return (
      <div className="pg-fields">
        {style}
        {basic.map((f) => (
          <Control key={f.k} f={f} vals={vals} up={up} />
        ))}
        {rest.length ? (
          <button type="button" className="pg-morebtn" onClick={() => setMore(!more)}>
            {more ? "Fewer options" : `More options (${rest.length})`}
          </button>
        ) : null}
        {more ? rest.map((f) => <Control key={f.k} f={f} vals={vals} up={up} />) : null}
      </div>
    );
  }
  return (
    <div className="pg-fields">
      {style}
      {fields.map((f) => (
        <Control key={f.k} f={f} vals={vals} up={up} />
      ))}
    </div>
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
  const file = useMemo(() => fileOf(gen, ds), [gen, ds, fonts]);
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
          <Panel gen={gen} s={s} set={set} />
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

/* ---------- the gallery of generators: round 2's C ---------- */
function Gallery() {
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
          <button
            key={g.key}
            type="button"
            className="pgs-card"
            onClick={() => setParam("gen", g.key)}
          >
            <Still id={"gen-" + g.key} file={() => fileOf(g.key, DEFAULTS)} />
            <b>{g.name}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

export function Generators() {
  const gen = useParam("gen") as GenKey | null;
  const [s, set] = useState<Settings>(DEFAULTS);
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  if (gen && GENS.some((g) => g.key === gen)) return <Editor gen={gen} s={s} set={set} />;
  return <Gallery />;
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
          {GENS.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={gen === g.key}
              onClick={() => setParam("gen", g.key)}
            >
              {g.name.replace(" code", "")}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
