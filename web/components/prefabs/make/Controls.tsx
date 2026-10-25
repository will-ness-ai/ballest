"use client";
// A Generator's controls (grill-design round 4, E · Simple, with More options): the main ones
// first and the rest behind "More options", every number a slider that shows its value.
import { useState } from "react";

import { FONTS, fontAt } from "./lettering";
import { PillButton, Pills } from "../../Controls";
import {
  COLOUR_NAMES,
  MARBLE,
  PIECE_FONT_INFO,
  isPieceFont,
  type PieceFontName,
  PICTURE_MOST,
  pictureOf,
  unitOf,
  type Colour,
  type Control,
  type Values,
} from "../../../lib/generators";
import { prefabHref } from "../../../lib/routes";

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
          <Pills label={c.label}>
            {c.options.map((o) => (
              <PillButton key={o} on={value === o} onClick={() => set({ [c.key]: o })}>
                {o}
              </PillButton>
            ))}
          </Pills>
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
          {Object.entries(PIECE_FONT_INFO).map(([name, f]) => (
            <button
              key={name}
              type="button"
              aria-pressed={value === name}
              className="built"
              onClick={() => set({ [c.key]: name })}
            >
              {f.letterCase === "upper" ? name.toUpperCase() : name.toLowerCase()}
            </button>
          ))}
          {isPieceFont(value) && <BuiltBy font={PIECE_FONT_INFO[value]} />}
        </fieldset>
      );
    case "picture":
      return <PictureField c={c} value={String(value ?? "")} set={set} />;
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

/* who built a piece font, from the editor's own track pieces, and the Prefabs it comes from */
function BuiltBy({ font }: { font: (typeof PIECE_FONT_INFO)[PieceFontName] }) {
  return (
    <p className="gen-built">
      Built by hand from track pieces by {font.by}: see{" "}
      {font.prefabs.map((p, i) => (
        <span key={p.slug}>
          {i > 0 && " and "}
          <a href={prefabHref(p.slug)}>{p.name}</a>
        </span>
      ))}
      . {font.letterCase === "upper" ? "Capitals" : "Lower case"} only.
    </p>
  );
}

/* an image file, drawn at most PICTURE_MOST pixels the longer way and read as a picture in the
   Generators' colours (pictureOf) */
async function pictureFrom(file: File) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, PICTURE_MOST / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [w, h];
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(img, 0, 0, w, h);
  return pictureOf(ctx.getImageData(0, 0, w, h).data, w, h);
}

function PictureField({
  c,
  value,
  set,
}: {
  c: Control;
  value: string;
  set: (change: Values) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const own = value !== MARBLE;
  return (
    <div className="gen-picture">
      <span className="gen-label">{c.label}</span>
      <label className="gen-file">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            pictureFrom(file).then(
              (p) => {
                setProblem(null);
                set({ [c.key]: p });
              },
              () => setProblem("That file isn't a picture this browser can read."),
            );
          }}
        />
        <span>{own ? "Choose another picture" : "Choose a picture"}</span>
      </label>
      {own ? (
        <button type="button" className="gen-more" onClick={() => set({ [c.key]: MARBLE })}>
          Back to the marble
        </button>
      ) : (
        <small>Until you choose one, it draws the site's marble.</small>
      )}
      {problem && <small className="gen-over">{problem}</small>}
    </div>
  );
}
