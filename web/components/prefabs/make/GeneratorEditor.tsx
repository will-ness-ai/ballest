"use client";
// A Generator's page (grill-design round 1, A): its controls on the left; the model, its size and
// piece count and Download on the right. The model is rebuilt from the values a moment after
// they stop changing, and a sign in a drawn font again once the web fonts have arrived.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Controls } from "./Controls";
import { FONTS, fontAt, letteringOf } from "./lettering";
import { HelpDialog } from "../PrefabModel";
import { PrefabViewer } from "../PrefabViewer";
import {
  PIECE_LIMIT,
  generate,
  generatorOf,
  type Generator,
  type Values,
} from "../../../lib/generators";
import { footprintOf, shapesOf } from "../../../lib/prefab";
import { fileNameOf } from "../../../lib/prefab-check";
import { makePrefabHref } from "../../../lib/routes";

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
  const download = () => {
    if (!file) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, "\t")], { type: "application/json" }),
    );
    a.download = fileNameOf(g.file);
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section className="gen">
      <header className="pfl-head">
        <div>
          <Link className="gen-back" href={makePrefabHref()}>
            ← All generators
          </Link>
          <h1>{g.name}</h1>
          <p>{g.blurb}</p>
        </div>
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
            <button type="button" className="pf-dl" disabled={!file || over} onClick={download}>
              Download
            </button>
            <HelpDialog name={g.file} auto={false} />
          </div>
        </div>
      </div>
    </section>
  );
}
