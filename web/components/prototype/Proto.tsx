"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: grill-design for a player's times on your Maps (claude/prototype-mymaps).
// Never merged: the winner is rebuilt by /implement-spec. ?variant= picks the design.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export const VARIANTS = [
  ["A", "Score card button", "A second link on the score card turns on a Your maps filter in their Workshop list, shown as a chip; while it is on, Campaigns and the two shelves step aside"],
  ["B", "Filter switch", "No button: a Your maps switch in the Workshop list's tools, beside search and sort; while it is on, Campaigns and the two shelves step aside"],
  ["C", "Seventh tile", "A Your maps tile after the Medal tiles, which filters the list the way a Medal tile does; while it is on, Campaigns and the two shelves step aside"],
  ["D", "Panel", "A Your maps panel opens the Workshop tab: every Map you made, their place or Not finished"],
  ["E", "Own tab", "A Your maps tab beside Circuit, Workshop and Daily, holding only their times on your Maps"],
] as const;
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
