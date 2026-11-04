"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: grill-design for the Shape fill Generator (claude/prototype-shape-fill).
// Never merged: the winner is rebuilt by /implement-spec. ?variant= picks the design.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export const VARIANTS = [
  ["A", "Anywhere", "Shapes of every size anywhere in the box, none touching"],
  ["B", "Clumps", "The same shapes gathered into a few clumps"],
  [
    "C",
    "Spiral round a pillar",
    "A clear middle with a white pillar, the shapes winding up round it",
  ],
  ["D", "Satellites", "A few big shapes, the small ones round each"],
  ["E", "Mixed shapes, pillar", "Spheres, cubes, cones, cylinders and pyramids round a pillar"],
] as const;

/* each variant's defaults for the Generator: what the page opens on */
export const PRESETS: Record<string, Record<string, string | number | boolean>> = {
  A: { layout: "Anywhere" },
  B: { layout: "Clumps", count: 200 },
  C: { layout: "Spiral", width: 8, depth: 8, height: 16, hole: 40, pillar: true, count: 220 },
  D: { layout: "Satellites", largest: 2.5, count: 200 },
  E: { layout: "Anywhere", shape: "Mixed", width: 8, depth: 8, hole: 40, pillar: true, count: 200 },
};
export type VariantKey = (typeof VARIANTS)[number][0];

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

export function useVariant(): VariantKey | null {
  const v = useSyncExternalStore(
    subscribe,
    () => param("variant") ?? "A",
    () => null,
  );
  if (v === null) return null;
  return (VARIANTS.find((x) => x[0] === v)?.[0] ?? "A") as VariantKey;
}

export function useParam(k: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => param(k),
    () => null,
  );
}

export function setParam(k: string, val: string | null) {
  const q = new URLSearchParams(location.search);
  if (val === null) q.delete(k);
  else q.set(k, val);
  history.replaceState(history.state, "", location.pathname + "?" + q.toString());
  emit();
}

export function ProtoPicker() {
  const v = useVariant();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
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
    () => window.top !== window,
    () => false,
  );
  const href = useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search,
    () => "",
  );
  if (!v || framed) return null;
  const label = VARIANTS.find((x) => x[0] === v)?.[1];
  const phone = view === "phone";
  const inner = (() => {
    const [path, query = ""] = href.split("?");
    const q = new URLSearchParams(query);
    q.delete("view");
    return path + "?" + q.toString();
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
        data-variants={JSON.stringify(VARIANTS)}
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
