"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE (claude/prototype-make-your-own): the grill-design picker. ?variant= names the
// design; ←/→ (buttons or keys) cycle it; Phone frames the page at 390px; the bottom row jumps
// between the gallery and a few Generators.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export const VARIANTS = [
  ["A", "Sections"],
  ["B", "Category chips"],
  ["C", "Category rail"],
  ["D", "Shelves"],
  ["E", "Category tiles"],
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
function setParam(k: string, v: string | null) {
  const q = new URLSearchParams(location.search);
  if (v === null) q.delete(k);
  else q.set(k, v);
  history.replaceState(history.state, "", location.pathname + "?" + q.toString());
  emit();
}
const useParam = (k: string) =>
  useSyncExternalStore(
    subscribe,
    () => param(k),
    () => null,
  );
export function useVariant(): VariantKey {
  const v = useParam("variant");
  return VARIANTS.find((x) => x[0] === v)?.[0] ?? "A";
}

const JUMPS = [
  ["Gallery", "/prefabs/make"],
  ["House", "/prefabs/make/house"],
  ["Tower", "/prefabs/make/tower"],
  ["Castle", "/prefabs/make/castle"],
] as const;

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
      if ((e.target as HTMLElement).closest("input, textarea, select, dialog")) return;
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
  const path = href.split("?")[0];
  if (framed || !path.startsWith("/prefabs/make")) return null;
  const phone = view === "phone";
  const inner = (() => {
    const [p, query = ""] = href.split("?");
    const q = new URLSearchParams(query);
    q.delete("view");
    q.set("framed", "1");
    return p + "?" + q.toString();
  })();
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
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
  const keep = new URLSearchParams(href.split("?")[1] ?? "");
  keep.delete("framed");
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
            {v} · {VARIANTS.find((x) => x[0] === v)?.[1]}
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
          {JUMPS.map(([name, to]) => (
            <a
              key={name}
              className="pp-jump"
              aria-current={path === to ? "page" : undefined}
              href={to + "?" + keep.toString()}
            >
              {name}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
