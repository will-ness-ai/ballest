"use client";
// PROTOTYPE (grill-design): the variant picker. Never merged.
import { useEffect, useState } from "react";

export interface PickerVariant {
  key: string;
  name: string;
  note: string;
}

export function Picker({
  variants,
  states,
}: {
  variants: Array<PickerVariant>;
  /* [label, href] links to other states (another Campaign) */
  states: Array<[string, string]>;
}) {
  const [at, setAt] = useState(-1);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const v = new URLSearchParams(location.search).get("variant");
    const i = variants.findIndex((x) => x.key === v);
    setAt((a) => (a >= 0 ? a : i < 0 ? 0 : i));
  }, [variants]);
  useEffect(() => {
    if (at < 0) return;
    const key = variants[at].key;
    document.documentElement.dataset.v = key;
    const u = new URL(location.href);
    u.searchParams.set("variant", key);
    history.replaceState(history.state, "", u);
  }, [at, variants]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") setAt((a) => (a + 1) % variants.length);
      if (e.key === "ArrowLeft") setAt((a) => (a - 1 + variants.length) % variants.length);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [variants.length]);
  const v = variants[Math.max(at, 0)];
  const keep = (href: string) => href + "?variant=" + v.key;
  return (
    <div
      className="proto-picker"
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button, a")) return;
        const box = e.currentTarget.getBoundingClientRect();
        const dx = e.clientX - box.left,
          dy = e.clientY - box.top;
        const move = (m: PointerEvent) => setPos({ x: m.clientX - dx, y: m.clientY - dy });
        const up = () => {
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", up);
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
      }}
    >
      <div className="pp-row">
        <button type="button" onClick={() => setAt((at - 1 + variants.length) % variants.length)}>
          &larr;
        </button>
        <b>
          {v.key} &middot; {v.name}
        </b>
        <button type="button" onClick={() => setAt((at + 1) % variants.length)}>
          &rarr;
        </button>
      </div>
      <p>{v.note}</p>
      <div className="pp-states">
        {states.map(([label, href]) => (
          <a key={href} href={keep(href)}>
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
