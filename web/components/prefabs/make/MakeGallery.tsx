"use client";
// The Make your own tab: a card per Generator, each with a still of what its defaults make,
// drawn in the browser by the gallery's shared renderer (scene.ts stillOf).
// PROTOTYPE (claude/prototype-make-your-own): ?variant= picks how the categories are laid out
// (components/prototype/Picker.tsx cycles them).
import Link from "next/link";
import { useEffect, useState } from "react";

import { PrefabTabs } from "../PrefabTabs";
import { stillOf } from "../scene";
import { useVariant } from "../../prototype/Picker";
import { CATEGORIES, GENERATORS, generate, type Generator } from "../../../lib/generators";
import { generatorHref } from "../../../lib/routes";

type Category = (typeof CATEGORIES)[number];
const BLURBS: Record<Category, string> = {
  Signs: "Words and codes in blocks.",
  Nature: "Trees and bushes to dress a map.",
  Buildings: "Houses, towers and castles.",
};
const inCat = (c: Category) => GENERATORS.filter((g) => g.category === c);

export function MakeGallery() {
  const v = useVariant();
  return (
    <section className="pfl">
      <header className="pfl-head">
        <div>
          <h1>Prefabs</h1>
          <p>Make a prefab from a few settings, then download it and spawn it into your map.</p>
        </div>
      </header>
      <PrefabTabs on="make" />
      {v === "B" ? (
        <Chips />
      ) : v === "C" ? (
        <Rail />
      ) : v === "D" ? (
        <Shelves />
      ) : v === "E" ? (
        <Tiles />
      ) : (
        <Sections />
      )}
    </section>
  );
}

/* A · a heading per category over its cards */
function Sections() {
  return (
    <>
      {CATEGORIES.map((c) => (
        <section key={c} className="mk-sec">
          <h2 className="pfu-h2">{c}</h2>
          <div className="gen-cards">
            {inCat(c).map((g) => (
              <Card key={g.key} g={g} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/* B · one grid, filtered by a row of category chips */
function Chips() {
  const [on, setOn] = useState<Category | null>(null);
  const shown = on ? inCat(on) : GENERATORS;
  return (
    <>
      <div className="pfl-tags" role="group" aria-label="Category">
        <button
          type="button"
          className={"pfl-tag" + (on === null ? " on" : "")}
          aria-pressed={on === null}
          onClick={() => setOn(null)}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={"pfl-tag" + (on === c ? " on" : "")}
            aria-pressed={on === c}
            onClick={() => setOn(c)}
          >
            {c} <small>{inCat(c).length}</small>
          </button>
        ))}
      </div>
      <div className="gen-cards">
        {shown.map((g) => (
          <Card key={g.key} g={g} tag={on ? undefined : g.category} />
        ))}
      </div>
    </>
  );
}

/* C · categories down a rail on the left, the picked one's cards beside it */
function Rail() {
  const [on, setOn] = useState<Category>("Nature");
  return (
    <div className="mk-rail">
      <nav aria-label="Category">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" aria-pressed={on === c} onClick={() => setOn(c)}>
            <b>{c}</b>
            <small>{BLURBS[c]}</small>
          </button>
        ))}
      </nav>
      <div className="gen-cards">
        {inCat(on).map((g) => (
          <Card key={g.key} g={g} />
        ))}
      </div>
    </div>
  );
}

/* D · a row per category that scrolls sideways */
function Shelves() {
  return (
    <>
      {CATEGORIES.map((c) => (
        <section key={c} className="mk-sec">
          <h2 className="pfu-h2">
            {c} <small className="mk-count">{inCat(c).length}</small>
          </h2>
          <div className="mk-shelf">
            {inCat(c).map((g) => (
              <Card key={g.key} g={g} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/* E · a big tile per category first; picking one shows its cards */
function Tiles() {
  const [on, setOn] = useState<Category | null>(null);
  if (on)
    return (
      <>
        <button type="button" className="gen-back mk-backbtn" onClick={() => setOn(null)}>
          ← All categories
        </button>
        <h2 className="pfu-h2">{on}</h2>
        <div className="gen-cards">
          {inCat(on).map((g) => (
            <Card key={g.key} g={g} />
          ))}
        </div>
      </>
    );
  return (
    <div className="mk-tiles">
      {CATEGORIES.map((c) => (
        <button key={c} type="button" className="mk-tile" onClick={() => setOn(c)}>
          <span className="mk-collage">
            {inCat(c)
              .slice(0, 3)
              .map((g) => (
                <Still key={g.key} g={g} />
              ))}
          </span>
          <b>{c}</b>
          <small>
            {BLURBS[c]} {inCat(c).length} to make.
          </small>
        </button>
      ))}
    </div>
  );
}

function Still({ g }: { g: Generator }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const file = generate(g.key, g.defaults);
    if (!file) return;
    let live = true;
    stillOf(file, 640, 400, undefined, g.angle ?? null).then(
      (s) => live && setSrc(s),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [g]);
  return <span className="gen-still">{src && <img src={src} alt="" />}</span>;
}

function Card({ g, tag }: { g: Generator; tag?: string }) {
  return (
    <Link className="gen-card" href={generatorHref(g.key)}>
      <Still g={g} />
      <b>{g.name}</b>
      {tag ? <span className="mk-tag">{tag}</span> : null}
      <small>{g.blurb}</small>
    </Link>
  );
}
