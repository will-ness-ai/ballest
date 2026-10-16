"use client";
/* PROTOTYPE (grill-design, claude/prototype-prefabs): the floating variant picker. Never merged. */
import { useEffect } from "react";

export type Variant = readonly [key: string, name: string, about: string];

export function Picker({
  variants,
  variant,
  states,
  state,
}: {
  variants: ReadonlyArray<Variant>;
  variant: string;
  states: ReadonlyArray<readonly [string, string]>;
  state: string;
}) {
  const i = Math.max(
    0,
    variants.findIndex((v) => v[0] === variant),
  );
  const go = (patch: Record<string, string>) => {
    const u = new URL(location.href);
    for (const [k, v] of Object.entries(patch)) u.searchParams.set(k, v);
    history.replaceState(null, "", u);
    location.reload();
  };
  const step = (d: number) =>
    go({ variant: variants[(i + d + variants.length) % variants.length][0] });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });
  const drag = (e: React.PointerEvent<HTMLElement>) => {
    const box = e.currentTarget;
    if ((e.target as HTMLElement).closest("button")) return;
    const r = box.getBoundingClientRect();
    const [dx, dy] = [e.clientX - r.left, e.clientY - r.top];
    const move = (m: PointerEvent) => {
      box.style.left = m.clientX - dx + "px";
      box.style.top = m.clientY - dy + "px";
      box.style.right = box.style.bottom = "auto";
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", () => removeEventListener("pointermove", move), { once: true });
  };
  const v = variants[i];
  return (
    <div className="proto-picker" role="region" aria-label="Prototype picker" onPointerDown={drag}>
      <div className="pp-row">
        <button type="button" onClick={() => step(-1)}>
          ←
        </button>
        <b>
          {v[0]} · {v[1]}
        </b>
        <button type="button" onClick={() => step(1)}>
          →
        </button>
      </div>
      <p>{v[2]}</p>
      <div className="pp-row">
        {states.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={k === state ? "on" : ""}
            onClick={() => go({ state: k })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
