"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: grill-design for the Prefab generators (claude/prototype-prefab-generators).
// Never merged: the winner is rebuilt by /implement-spec. /prefabs/make is the gallery of
// generators, drawn as ?variant= names it (round 2); ?gen=<key> opens one generator in round
// 1's winning layout (A: controls left, model right). ProtoPicker (in the layout) cycles the
// variants and frames the phone view.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { PrefabViewer } from "../prefabs/PrefabViewer";
import { stillOf } from "../prefabs/scene";
import type { PrefabFile } from "../../lib/prefab";
import { prefabsHref } from "../../lib/routes";
import {
  COLOURS,
  PIECE_LIMIT,
  SWATCH,
  bushFile,
  qrFile,
  signFile,
  treeFile,
  type BushSettings,
  type Colour,
  type QrSettings,
  type SignSettings,
  type TreeSettings,
  type TreeStyle,
} from "./gen";

/* ---------- the variant switch ---------- */
const VARIANTS = [
  ["A", "Card grid"],
  ["B", "Shelves by kind"],
  ["C", "Tab beside the shared prefabs"],
  ["D", "List with what you can change"],
  ["E", "Showcase and thumbnails"],
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
  tree: TreeSettings;
  bush: BushSettings;
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
  },
  tree: { style: "Round", height: 6, spread: 4, trunk: "Wine", leaves: "Lime", seed: 7 },
  bush: { width: 2, height: 1.2, clumps: 5, colour: "Lime", seed: 3 },
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
    blurb: "A round, pine or blocky tree at any height.",
    changes: ["Style", "Height and spread", "Colours", "Shuffle"],
  },
  {
    key: "bush",
    name: "Bush",
    group: "Nature",
    blurb: "A clump of leaves to dress a corner.",
    changes: ["Size", "Clumps", "Colour", "Shuffle"],
  },
];

function fileOf(key: GenKey, s: Settings): PrefabFile | null {
  if (key === "qr") return qrFile(s.qr)?.file ?? null;
  if (key === "sign") return signFile(s.sign)?.file ?? null;
  if (key === "tree") return treeFile(s.tree);
  return bushFile(s.bush);
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

/* the footprint of a file's pieces in metres (cubes and spheres only need their scale) */
function sizeOf(file: PrefabFile) {
  let x0 = Infinity,
    x1 = -Infinity,
    z1 = 0;
  for (const it of file.items) {
    const [x, , z] = it.transform.location;
    const base = it.class.includes("Cube")
      ? 1000
      : it.class.includes("Sphere")
        ? 400
        : it.class.includes("Cone")
          ? 300
          : 1000;
    const tall = it.class.includes("Cylinder") || it.class.includes("Cone") ? 200 : base;
    const w = (it.transform.scale[0] * base) / 2;
    x0 = Math.min(x0, x - w);
    x1 = Math.max(x1, x + w);
    z1 = Math.max(z1, z + it.transform.scale[2] * tall);
  }
  return { w: (x1 - x0) / 100, h: z1 / 100 };
}

/* ---------- stills for the gallery ---------- */
const stills = new Map<string, Promise<string>>();
function Still({ gen, className = "pgs-still" }: { gen: GenKey; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!stills.has(gen)) stills.set(gen, stillOf(fileOf(gen, DEFAULTS)!, 640, 400));
    void stills.get(gen)!.then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [gen]);
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
        <Toggle label="Wall behind the text" on={t.wall} set={(b) => up({ wall: b })} />
        {t.wall ? <Swatches label="Wall" value={t.back} set={(c) => up({ back: c })} /> : null}
        <Swatches label="Letters" value={t.front} set={(c) => up({ front: c })} />
      </div>
    );
  }
  if (gen === "tree") {
    const t = s.tree;
    const up = (p: Partial<TreeSettings>) => set({ ...s, tree: { ...t, ...p } });
    return (
      <div className="pg-fields">
        <Seg<TreeStyle>
          label="Style"
          value={t.style}
          options={["Round", "Pine", "Blocky"]}
          set={(v) => up({ style: v })}
        />
        <div className="pg-row">
          <Num
            label="Height"
            value={t.height}
            set={(n) => up({ height: n })}
            min={1}
            max={40}
            step={0.5}
            unit="m"
          />
          <Num
            label="Spread"
            value={t.spread}
            set={(n) => up({ spread: n })}
            min={0.5}
            max={30}
            step={0.5}
            unit="m"
          />
        </div>
        <Swatches label="Trunk" value={t.trunk} set={(c) => up({ trunk: c })} />
        <Swatches label="Leaves" value={t.leaves} set={(c) => up({ leaves: c })} />
        <button
          type="button"
          className="pg-ghost"
          onClick={() => up({ seed: Math.floor(Math.random() * 1e9) })}
        >
          Shuffle
        </button>
      </div>
    );
  }
  const b = s.bush;
  const up = (p: Partial<BushSettings>) => set({ ...s, bush: { ...b, ...p } });
  return (
    <div className="pg-fields">
      <div className="pg-row">
        <Num
          label="Width"
          value={b.width}
          set={(n) => up({ width: n })}
          min={0.3}
          max={20}
          step={0.1}
          unit="m"
        />
        <Num
          label="Height"
          value={b.height}
          set={(n) => up({ height: n })}
          min={0.2}
          max={10}
          step={0.1}
          unit="m"
        />
      </div>
      <Num
        label="Clumps"
        value={b.clumps}
        set={(n) => up({ clumps: Math.round(n) })}
        min={1}
        max={30}
      />
      <Swatches label="Leaves" value={b.colour} set={(c) => up({ colour: c })} />
      <button
        type="button"
        className="pg-ghost"
        onClick={() => up({ seed: Math.floor(Math.random() * 1e9) })}
      >
        Shuffle
      </button>
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
  const file = useMemo(() => fileOf(gen, ds), [gen, ds]);
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
                <b>{metres(size.w)}</b> wide × <b>{metres(size.h)}</b> tall
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
          <small className="pg-note">Moves: Upload to the gallery is gone (round 1 verdict).</small>
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

function GalleryA() {
  return (
    <section className="pg">
      <Head />
      <div className="pgs-grid">
        {GENS.map((g) => (
          <button key={g.key} type="button" className="pgs-card" onClick={() => open(g.key)}>
            <Still gen={g.key} />
            <b>{g.name}</b>
            <small>{g.blurb}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function GalleryB() {
  return (
    <section className="pg">
      <Head />
      {(["Signs", "Nature"] as const).map((grp) => (
        <div key={grp} className="pgs-shelf">
          <h2 className="pfu-h2">{grp}</h2>
          <div className="pgs-row">
            {GENS.filter((g) => g.group === grp).map((g) => (
              <button key={g.key} type="button" className="pgs-card" onClick={() => open(g.key)}>
                <Still gen={g.key} />
                <b>{g.name}</b>
                <small>{g.blurb}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
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
      <small className="pg-note">
        Moves: the generators live on the Prefabs page under a second tab; this page reuses its
        heading.
      </small>
    </section>
  );
}

function GalleryD() {
  return (
    <section className="pg">
      <Head />
      <div className="pgs-list">
        {GENS.map((g) => (
          <button key={g.key} type="button" className="pgs-item" onClick={() => open(g.key)}>
            <Still gen={g.key} className="pgs-still thumb" />
            <span className="pgs-txt">
              <b>{g.name}</b>
              <small>{g.blurb}</small>
              <span className="pgs-chips">
                {g.changes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </span>
            </span>
            <span className="pgs-go" aria-hidden>
              →
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function GalleryE() {
  const [pick, setPick] = useState<GenKey>("tree");
  const g = GENS.find((x) => x.key === pick)!;
  const file = useMemo(() => fileOf(pick, DEFAULTS), [pick]);
  return (
    <section className="pg">
      <Head />
      <div className="pgs-show">
        <div className="pg-view">{file ? <PrefabViewer key={pick} file={file} /> : null}</div>
        <div className="pgs-showtxt">
          <h2>{g.name}</h2>
          <p>{g.blurb}</p>
          <button type="button" className="pf-dl" onClick={() => open(pick)}>
            Make one
          </button>
        </div>
      </div>
      <div className="pgs-strip">
        {GENS.map((x) => (
          <button
            key={x.key}
            type="button"
            aria-pressed={pick === x.key}
            onClick={() => setPick(x.key)}
          >
            <Still gen={x.key} className="pgs-still thumb" />
            <span>{x.name}</span>
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
  return v === "A" ? (
    <GalleryA />
  ) : v === "B" ? (
    <GalleryB />
  ) : v === "C" ? (
    <GalleryC />
  ) : v === "D" ? (
    <GalleryD />
  ) : (
    <GalleryE />
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
        {gen ? (
          <div className="pp-row">
            <button type="button" onClick={() => setParam("gen", null)}>
              Back to the gallery
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
