"use client";
// The collage /prefabs/collage draws: for ?g=<generator>, a row per variation (variationsOf,
// narrowed by ?only=a,b), each from the front, the back and above, every tile drawn by the
// gallery's still renderer (scene.ts stillOf) with its piece count in the corner. The page is
// marked ready (data-ready) once every tile has drawn, for the screenshot script to wait on.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { stillOf } from "../scene";
import { generate, generatorOf, variationsOf, type Values } from "../../../lib/generators";
import type { PrefabAngle } from "../../../lib/prefabs";

/* where each column's camera looks from, the whole Prefab in view */
const view = (from: PrefabAngle["from"]): PrefabAngle => ({ from, zoom: 1, pan: [0, 0, 0] });
const ANGLES: ReadonlyArray<[string, PrefabAngle]> = [
  ["front", view([-0.75, 0.45, 0.5])],
  ["back", view([0.7, 0.4, -0.6])],
  ["above", view([-0.15, 0.98, 0.1])],
];

function Tile({
  generator,
  values,
  angle,
  done,
}: {
  generator: string;
  values: Values;
  angle: PrefabAngle;
  done: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const file = useMemo(() => generate(generator, values), [generator, values]);
  useEffect(() => {
    if (!file) {
      done();
      return;
    }
    let live = true;
    stillOf(file, 280, 190, undefined, angle).then((s) => {
      if (live) setSrc(s);
      done();
    }, done);
    return () => {
      live = false;
    };
  }, [file, angle, done]);
  return (
    <div className="gen-collage-tile">
      {src && <img src={src} alt="" width={280} height={190} />}
      <small>{file?.items.length ?? "nothing"}</small>
    </div>
  );
}

export function GeneratorCollage() {
  /* the address's query, read once the page is in the browser */
  const search = useSyncExternalStore(
    () => () => undefined,
    () => location.search,
    () => null,
  );
  const query = useMemo(() => {
    if (search === null) return null;
    const q = new URLSearchParams(search);
    return { g: q.get("g") ?? "", only: q.get("only")?.split(",") };
  }, [search]);
  const [drawn, setDrawn] = useState(0);
  const gen = query ? generatorOf(query.g) : null;
  /* each row's values made once, so a tile draws once */
  const rows = useMemo(() => (gen ? variationsOf(gen, query?.only) : []), [gen, query]);
  const done = useCallback(() => setDrawn((n) => n + 1), []);
  if (!query) return null;
  if (!gen) return <p className="gen-collage">?g= one of the Generators&apos; keys</p>;
  return (
    <div className="gen-collage" data-ready={drawn >= rows.length * ANGLES.length || undefined}>
      {rows.map(({ label, values }) => (
        <div key={label} className="gen-collage-row">
          <b>{label}</b>
          {ANGLES.map(([name, angle]) => (
            <Tile key={name} generator={gen.key} values={values} angle={angle} done={done} />
          ))}
        </div>
      ))}
    </div>
  );
}
