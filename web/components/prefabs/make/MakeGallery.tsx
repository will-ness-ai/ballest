"use client";
// The Generate your own tab (grill-design round 1 of #310, A · Sections): a heading per category,
// in CATEGORIES' order, over a card per Generator, each with a still of what its defaults
// make, drawn in the browser by the gallery's shared renderer (scene.ts stillOf).
import Link from "next/link";
import { useEffect, useState } from "react";

import { PrefabsHead } from "../PrefabTabs";
import { stillOf } from "../scene";
import { CATEGORIES, GENERATORS, generate, type Generator } from "../../../lib/generators";
import { generatorHref } from "../../../lib/routes";

export function MakeGallery() {
  return (
    <section className="pfl">
      <PrefabsHead
        on="make"
        blurb="Make a prefab from a few settings, then download it and spawn it into your map."
      />
      {CATEGORIES.map((c) => (
        <section key={c} className="gen-group">
          <h2 className="pfu-h2">{c}</h2>
          <div className="gen-cards">
            {GENERATORS.filter((g) => g.category === c).map((g) => (
              <Card key={g.key} g={g} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function Card({ g }: { g: Generator }) {
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
  return (
    <Link className="gen-card" href={generatorHref(g.key)}>
      <span className="gen-still">{src && <img src={src} alt="" />}</span>
      <b>{g.name}</b>
      <small>{g.blurb}</small>
    </Link>
  );
}
