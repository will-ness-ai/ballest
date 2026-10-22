"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: the collage /proto-collage draws: for ?g=<generator>, each row one combination of
// settings (COMBOS), each column one angle, every tile drawn by the gallery's still renderer.
import { useEffect, useState } from "react";

import { stillOf } from "../prefabs/scene";
import { generate, generatorOf, type Values } from "../../lib/generators";
import type { PrefabAngle } from "../../lib/prefabs";

const ANGLES: Array<[string, PrefabAngle]> = [
  ["front", { from: [-0.75, 0.45, 0.5], zoom: 1, pan: [0, 0, 0] }],
  ["back", { from: [0.7, 0.4, -0.6], zoom: 1, pan: [0, 0, 0] }],
  ["side", { from: [0.05, 0.2, 0.98], zoom: 1, pan: [0, 0, 0] }],
  ["top", { from: [-0.15, 0.98, 0.1], zoom: 1, pan: [0, 0, 0] }],
];

const COMBOS: Record<string, Array<[string, Values]>> = {
  house: [
    ["defaults", {}],
    ["1 floor, hip", { floors: 1, roof: "Hip" }],
    ["3 floors, flat", { floors: 3, roof: "Flat" }],
    ["16x8, 5 windows", { width: 16, depth: 8, windows: 5 }],
    ["4x4, no windows", { width: 4, depth: 4, floors: 1, windows: 0, chimney: false }],
    ["steep 55°, 2 floors", { pitch: 55 }],
  ],
  tower: [
    ["defaults", {}],
    ["no setbacks, flat", { setbacks: 0, crown: "Flat" }],
    ["60 floors, 4 setbacks, antenna", { floors: 60, setbacks: 4, crown: "Antenna" }],
    ["round", { shape: "Round", columns: 8 }],
    ["30 m wide, 8 floors", { width: 30, floors: 8 }],
    ["round, 4 setbacks, flat", { shape: "Round", setbacks: 4, crown: "Flat", width: 24 }],
  ],
  castle: [
    ["defaults", {}],
    ["no towers, no keep", { towers: false, keep: false }],
    ["60 m, 12 m walls", { size: 60, height: 12 }],
    ["10 m, 3 m walls", { size: 10, height: 3 }],
    ["no gate", { gate: 0 }],
    ["battlements 3 m", { merlons: 3 }],
  ],
};

function Tile({ g, values, angle }: { g: string; values: Values; angle: PrefabAngle }) {
  const [src, setSrc] = useState<string | null>(null);
  const [pieces, setPieces] = useState(0);
  useEffect(() => {
    const file = generate(g, values);
    if (!file) return;
    setPieces(file.items.length);
    let live = true;
    stillOf(file, 320, 220, "#141a2b", angle).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [g, values, angle]);
  return (
    <div style={{ position: "relative", width: 320, height: 220, background: "#141a2b" }}>
      {src ? <img src={src} alt="" width={320} height={220} /> : null}
      <small style={{ position: "absolute", right: 4, bottom: 2, color: "#8a90a0" }}>
        {pieces}
      </small>
    </div>
  );
}

export function Collage() {
  const [g, setG] = useState<string | null>(null);
  useEffect(() => setG(new URLSearchParams(location.search).get("g")), []);
  const gen = g ? generatorOf(g) : null;
  if (!g || !gen) return <p>?g=house|tower|castle</p>;
  return (
    <div
      id="collage"
      style={{
        display: "grid",
        gap: 4,
        padding: 4,
        background: "#0b0f1a",
        width: "max-content",
        font: "12px system-ui",
        color: "#e8ecf2",
      }}
    >
      {(COMBOS[g] ?? [["defaults", {}]]).map(([label, change]) => (
        <div key={label} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <b style={{ width: 110 }}>{label}</b>
          {ANGLES.map(([name, angle]) => (
            <Tile key={name} g={g} values={{ ...gen.defaults, ...change }} angle={angle} />
          ))}
        </div>
      ))}
    </div>
  );
}
