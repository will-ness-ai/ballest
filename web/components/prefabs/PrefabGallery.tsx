"use client";
// The Prefabs gallery (grill-design round 2, A · Gallery): a card per Prefab with a still
// picture, its name, favorites, uploader and piece count; Popular | Newest and tag chips
// above, and Upload. Each picture is drawn in the browser from the Prefab's file by one
// shared renderer (stillOf) from the angle its uploader picked, so no image is stored.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Heart } from "./Heart";
import { stillOf } from "./scene";
import type { PrefabCard } from "../../db/prefabs";
import { fetchPrefabFile, type PrefabFile } from "../../lib/prefab";
import { TAGS, galleryOf, type GallerySort, type PrefabAngle } from "../../lib/prefabs";
import { newPrefabHref, prefabFileHref, prefabHref } from "../../lib/routes";

/* a Prefab's picture, drawn once its card scrolls near, from its file or the URL it's at */
export function Still({
  src,
  file,
  angle = null,
  w = 480,
  h = 320,
}: {
  src?: string;
  file?: PrefabFile;
  angle?: PrefabAngle | null;
  w?: number;
  h?: number;
}) {
  const [img, setImg] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  /* an angle by value, so a new object with the same view doesn't redraw */
  const view = JSON.stringify(angle);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const run = { live: true };
    const seen = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        seen.disconnect();
        void (file ? Promise.resolve(file) : fetchPrefabFile(src ?? ""))
          .then((f) => stillOf(f, w, h, undefined, JSON.parse(view) as PrefabAngle | null))
          .then((s) => run.live && setImg(s))
          .catch(() => undefined);
      },
      { rootMargin: "200px" },
    );
    seen.observe(el);
    return () => {
      run.live = false;
      seen.disconnect();
    };
  }, [src, file, view, w, h]);
  return (
    <span ref={box} className="pfl-still" style={{ aspectRatio: `${String(w)} / ${String(h)}` }}>
      {img && <img src={img} alt="" />}
    </span>
  );
}

type CardFacts = Pick<PrefabCard, "slug" | "name" | "favorites" | "uploader" | "pieces" | "angle">;

/* a Prefab's card; with `file`, the card a Prefab not yet uploaded will make */
export function Card({ p, file }: { p: CardFacts; file?: PrefabFile }) {
  const inner = (
    <>
      {file ? (
        <Still file={file} angle={p.angle} />
      ) : (
        <Still src={prefabFileHref(p.slug)} angle={p.angle} />
      )}
      <span className="pfl-cardrow">
        <span className="pfl-name">{p.name}</span>
        <span className="pfl-favs" aria-label={`${String(p.favorites)} favorites`}>
          <Heart /> {p.favorites}
        </span>
      </span>
      <span className="pfl-sub">
        by {p.uploader.name} · {p.pieces} pieces
      </span>
    </>
  );
  return file ? (
    <div className="pfl-card">{inner}</div>
  ) : (
    <Link className="pfl-card" href={prefabHref(p.slug)}>
      {inner}
    </Link>
  );
}

export function PrefabGallery({ cards }: { cards: Array<PrefabCard> }) {
  const [sort, setSort] = useState<GallerySort>("popular");
  const [tag, setTag] = useState<string | null>(null);
  const shown = galleryOf(cards, sort, tag);
  return (
    <section className="pfl">
      <header className="pfl-head">
        <div>
          <h1>Prefabs</h1>
          <p>
            Ready-made pieces for the level editor. Download one, drop it in your Prefabs folder and
            spawn it into your map.
          </p>
        </div>
        <Link className="pf-dl" href={newPrefabHref()}>
          + Upload
        </Link>
      </header>
      <div className="pfl-bar">
        <div className="pfl-seg" role="group" aria-label="Sort">
          {(["popular", "newest"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sort === s}
              className={sort === s ? "on" : ""}
              onClick={() => setSort(s)}
            >
              {s === "popular" ? "Popular" : "Newest"}
            </button>
          ))}
        </div>
        <div className="pfl-tags" role="group" aria-label="Tag">
          {TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className={"pfl-tag" + (tag === t ? " on" : "")}
              aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? null : t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="pfl-grid">
        {shown.map((p) => (
          <Card key={p.slug} p={p} />
        ))}
        {!shown.length && (
          <p className="pfl-sub">{tag ? "No prefabs with that tag yet." : "No prefabs yet."}</p>
        )}
      </div>
    </section>
  );
}
