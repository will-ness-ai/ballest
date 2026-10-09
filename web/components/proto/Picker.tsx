"use client";
// PROTOTYPE (grill-design, Circuit tab): the variant picker. It reads `?variant=` into
// <html data-variant>, which proto.css keys every variant off. Never merged.
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const VARIANTS = [
  ["A", "Segmented in the rail"],
  ["B", "Sub-tabs under the tabs"],
  ["C", "Dropdown on the heading"],
  ["D", "Accordion rail"],
  ["E", "Chips above the card"],
] as const;

/* the URL's variant, else the last one picked in this tab, so clicking around keeps it */
const read = () => {
  let v = new URLSearchParams(location.search).get("variant");
  try {
    v ??= sessionStorage.getItem("proto-variant");
  } catch {
    /* storage blocked: the URL alone */
  }
  return VARIANTS.findIndex(([k]) => k === v);
};

export function Picker() {
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();

  useEffect(() => {
    setI(Math.max(0, read()));
  }, []);

  useEffect(() => {
    const key = VARIANTS[i][0];
    document.documentElement.dataset.variant = key;
    const u = new URL(location.href);
    u.searchParams.set("variant", key);
    history.replaceState(history.state, "", u);
    try {
      sessionStorage.setItem("proto-variant", key);
    } catch {
      /* storage blocked */
    }
  }, [i, path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") setI((n) => (n + 1) % VARIANTS.length);
      if (e.key === "ArrowLeft") setI((n) => (n + VARIANTS.length - 1) % VARIANTS.length);
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
    };
  }, []);

  /* drag by the label */
  const drag = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left,
      dy = e.clientY - r.top;
    const move = (m: PointerEvent) => {
      el.style.left = `${String(m.clientX - dx)}px`;
      el.style.top = `${String(m.clientY - dy)}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const [k, label] = VARIANTS[i];
  return (
    <div className="ppicker" ref={box}>
      <button
        aria-label="Previous variant"
        onClick={() => {
          setI((n) => (n + VARIANTS.length - 1) % VARIANTS.length);
        }}
      >
        &#8592;
      </button>
      <span onPointerDown={drag}>
        PROTOTYPE {k} · {label}
      </span>
      <button
        aria-label="Next variant"
        onClick={() => {
          setI((n) => (n + 1) % VARIANTS.length);
        }}
      >
        &#8594;
      </button>
    </div>
  );
}
