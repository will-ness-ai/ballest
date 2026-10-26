"use client";
// A Generator's page (grill-design round 1, A): its controls on the left; the model, its size and
// piece count and Download on the right. The model is rebuilt from the values a moment after
// they stop changing, and a sign in a drawn font again once the web fonts have arrived.
import { useEffect, useMemo, useState } from "react";

import { Controls } from "./Controls";
import { FONTS, fontAt, letteringOf } from "./lettering";
import { HelpDialog } from "../PrefabModel";
import { PrefabViewer } from "../PrefabViewer";
import {
  PIECE_LIMIT,
  generate,
  generatorOf,
  spawnsOf,
  type Generator,
  type Values,
} from "../../../lib/generators";
import { footprintOf, shapesOf } from "../../../lib/prefab";
import { fileNameOf } from "../../../lib/prefab-check";

function useSettled<T>(value: T, ms = 200) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/* bumps once the drawn fonts have loaded, so a sign drawn before them is drawn again */
function useFontsLoaded(on: boolean) {
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    if (!on) return;
    const bump = () => setLoaded((n) => n + 1);
    void Promise.all(
      FONTS.filter(([, css]) => css).map(([, css]) => document.fonts.load(fontAt(css, "40px"))),
    ).then(bump, bump);
  }, [on]);
  return loaded;
}

const metres = (m: number) => (m >= 10 ? m.toFixed(0) : String(Number(m.toFixed(1)))) + " m";

export function GeneratorEditor({ generator }: { generator: string }) {
  const g = generatorOf(generator);
  return g ? <Editor g={g} /> : null;
}

function Editor({ g }: { g: Generator }) {
  const generator = g.key;
  const [values, setValues] = useState<Values>(g.defaults);
  const settled = useSettled(values);
  const fonts = useFontsLoaded(!!g.lettered);
  const file = useMemo(
    () =>
      generate(
        generator,
        settled,
        g.lettered ? letteringOf(String(settled.font), Number(settled.detail)) : undefined,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fonts: draw again once they load
    [g, settled, fonts],
  );
  const box = file ? footprintOf(shapesOf(file)) : null;
  /* wide is the longer way across, whichever way the Prefab faces */
  const size = box && { w: Math.max(box.w, box.d), d: Math.min(box.w, box.d), h: box.h };
  const pieces = file?.items.length ?? 0;
  const over = pieces > PIECE_LIMIT;
  /* more pieces than one spawn holds come in parts, spawned one after another */
  const { parts, marked } = useMemo(
    () => (file && !over ? spawnsOf(file) : { parts: [], marked: false }),
    [file, over],
  );
  const partName = (part: number) => (parts.length > 1 ? `${g.file}_${String(part + 1)}` : g.file);
  const download = (part: number) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(parts[part], null, "\t")], { type: "application/json" }),
    );
    a.download = fileNameOf(partName(part));
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section className="gen">
      <header className="pfl-head">
        <p>{g.blurb}</p>
      </header>
      <div className="gen-split">
        <Controls
          controls={g.controls(values)}
          values={values}
          set={(change) => setValues((v) => ({ ...v, ...change }))}
        />
        <div className="gen-side">
          <div className="gen-view">
            {file ? (
              <PrefabViewer file={file} spin={false} angle={g.angle ?? null} />
            ) : g.refuses?.(settled) ? (
              <p className="gen-empty">Keep it friendly: try different words.</p>
            ) : (
              <p className="gen-empty">Type something to make it.</p>
            )}
          </div>
          {size && (
            <p className="gen-stats">
              <span>
                <b>{metres(size.w)}</b> wide × <b>{metres(size.d)}</b> deep ×{" "}
                <b>{metres(size.h)}</b> tall
              </span>
              <span className={over ? "gen-over" : undefined}>
                <b>{pieces.toLocaleString("en-US")}</b> pieces
                {over && `: the game takes at most ${PIECE_LIMIT.toLocaleString("en-US")}`}
              </span>
            </p>
          )}
          <div className="gen-actions">
            {parts.length > 1 ? (
              parts.map((_, i) => (
                <button key={i} type="button" className="btn" onClick={() => download(i)}>
                  Part {i + 1}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="btn"
                disabled={!parts.length}
                onClick={() => download(0)}
              >
                Download
              </button>
            )}
            <HelpDialog name={partName(0)} auto={false} />
          </div>
          {parts.length > 1 && (
            <p className="gen-parts">
              Too many pieces for the game to spawn at once, so it comes in {parts.length} parts.
              Spawn them in order without moving the camera ({partName(0)}, then {partName(1)}
              {parts.length > 2 ? " and so on" : ""}), and they meet.
              {marked &&
                " Then delete the small white cubes at the near corner: they only line the parts up."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
