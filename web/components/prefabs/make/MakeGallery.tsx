"use client";
// The Make your own tab: a card per Generator, each with a still of what its defaults make,
// drawn in the browser by the gallery's shared renderer (scene.ts stillOf).
import Link from "next/link";
import { useEffect, useState } from "react";

import { PrefabTabs } from "../PrefabTabs";
import { stillOf } from "../scene";
import { GENERATORS, generate, type Generator } from "../../../lib/generators";
import { generatorHref } from "../../../lib/routes";

export function MakeGallery() {
  return (
    <section className="pfl">
      <header className="pfl-head">
        <div>
          <h1>Prefabs</h1>
          <p>Make a prefab from a few settings, then download it and spawn it into your map.</p>
        </div>
      </header>
      <PrefabTabs on="make" />
      <div className="gen-cards">
        {GENERATORS.map((g) => (
          <Card key={g.key} g={g} />
        ))}
      </div>
    </section>
  );
}

function Card({ g }: { g: Generator }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const file = generate(g.key, g.defaults);
    if (!file) return;
    let live = true;
    stillOf(file, 640, 400).then(
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
