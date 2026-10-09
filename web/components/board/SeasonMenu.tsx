"use client";
// The phone's season chip: a <details> whose menu closes on a pick, a tap outside it, or
// Escape, the way the board sheet beside it does.
import { useEffect, useRef, type ReactNode } from "react";

export function SeasonMenu({ label, children }: { label: string; children: ReactNode }) {
  const box = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = () => {
      if (box.current) box.current.open = false;
    };
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    addEventListener("pointerdown", onDown);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("pointerdown", onDown);
      removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details className="seasonchip" ref={box}>
      <summary aria-label={`Season: ${label}`}>
        {label} <span aria-hidden="true">&#9662;</span>
      </summary>
      <div
        className="seasonmenu"
        onClick={(e) => {
          if ((e.target as Element).closest("a") && box.current) box.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
