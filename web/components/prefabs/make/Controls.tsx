"use client";
// A Generator's controls (grill-design round 4, E · Simple, with More options): the main ones
// first and the rest behind "More options", every number a slider that shows its value.
import { useState } from "react";

import { FONTS, fontAt } from "./lettering";
import { COLOUR_NAMES, type Colour, type Control, type Values } from "../../../lib/generators";

/* the swatch each colour shows: the same words the viewer colours pieces by (lib/prefab.ts) */
const SWATCH: Record<Colour, string> = {
  White: "var(--gen-white)",
  Dark: "var(--gen-dark)",
  Red: "var(--gen-red)",
  Orange: "var(--gen-orange)",
  Yellow: "var(--gen-yellow)",
  Lime: "var(--gen-lime)",
  Blue: "var(--gen-blue)",
  "Sky blue": "var(--gen-sky)",
  Purple: "var(--gen-purple)",
  Wine: "var(--gen-wine)",
  Iron: "var(--gen-iron)",
  Copper: "var(--gen-copper)",
  Aluminum: "var(--gen-aluminum)",
};

export function Controls({
  controls,
  values,
  set,
}: {
  controls: Array<Control>;
  values: Values;
  set: (change: Values) => void;
}) {
  const [more, setMore] = useState(false);
  const main = controls.filter((c) => !c.more);
  const rest = controls.filter((c) => c.more);
  return (
    <div className="gen-controls">
      {main.map((c) => (
        <Field key={c.key} c={c} value={values[c.key]} set={set} />
      ))}
      {rest.length ? (
        <button
          type="button"
          className="gen-more"
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          {more ? "Fewer options" : `More options (${String(rest.length)})`}
        </button>
      ) : null}
      {more && rest.map((c) => <Field key={c.key} c={c} value={values[c.key]} set={set} />)}
    </div>
  );
}

const shown = (n: number, step: number) =>
  step < 1 ? String(Number(n.toFixed(step < 0.1 ? 2 : 1))) : String(Math.round(n));
const unitOf = (unit?: string) => (!unit ? "" : unit === "°" || unit === "%" ? unit : " " + unit);

function Field({
  c,
  value,
  set,
}: {
  c: Control;
  value: Values[string] | undefined;
  set: (change: Values) => void;
}) {
  switch (c.kind) {
    case "number": {
      const v = Number(value);
      return (
        <label className="gen-slider">
          <span className="gen-label">
            <span>{c.label}</span>
            <output>
              {shown(v, c.step)}
              {unitOf(c.unit)}
            </output>
          </span>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={v}
            style={
              {
                "--fill": `${String(((v - c.min) / (c.max - c.min)) * 100)}%`,
              } as React.CSSProperties
            }
            onChange={(e) => set({ [c.key]: Number(e.target.value) })}
          />
        </label>
      );
    }
    case "colour":
      return (
        <fieldset className="gen-swatches">
          <legend className="gen-label">{c.label}</legend>
          {COLOUR_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={value === name}
              aria-label={name}
              title={name}
              style={{ background: SWATCH[name] }}
              onClick={() => set({ [c.key]: name })}
            />
          ))}
        </fieldset>
      );
    case "choice":
      return (
        <fieldset className="gen-choice">
          <legend className="gen-label">{c.label}</legend>
          <div>
            {c.options.map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={value === o}
                onClick={() => set({ [c.key]: o })}
              >
                {o}
              </button>
            ))}
          </div>
        </fieldset>
      );
    case "toggle":
      return (
        <label className="gen-toggle">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => set({ [c.key]: e.target.checked })}
          />
          <span>{c.label}</span>
        </label>
      );
    case "text":
      return (
        <label className="gen-text">
          <span className="gen-label">{c.label}</span>
          {c.lines ? (
            <textarea
              rows={c.lines}
              value={String(value ?? "")}
              onChange={(e) => set({ [c.key]: e.target.value })}
            />
          ) : (
            <input value={String(value ?? "")} onChange={(e) => set({ [c.key]: e.target.value })} />
          )}
        </label>
      );
    case "font":
      return (
        <fieldset className="gen-fonts">
          <legend className="gen-label">{c.label}</legend>
          {FONTS.map(([name, css]) => (
            <button
              key={name}
              type="button"
              aria-pressed={value === name}
              className={css ? undefined : "pixel"}
              style={css ? { font: fontAt(css, "1rem") } : undefined}
              onClick={() => set({ [c.key]: name })}
            >
              {name}
            </button>
          ))}
        </fieldset>
      );
    case "shuffle":
      return (
        <button
          type="button"
          className="gen-shuffle"
          onClick={() => set({ [c.key]: Math.floor(Math.random() * 1e9) })}
        >
          Shuffle
        </button>
      );
  }
}
