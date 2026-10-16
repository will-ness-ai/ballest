"use client";
/* PROTOTYPE (grill-design, claude/prototype-prefabs): the Prefabs list as round 2 settled
   it: A · Gallery, most favorited first with a Popular | Newest switch, tag chips to filter,
   a heart count on each card, and Upload. ?state=many shows two dozen. Never merged. */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { PrefabFacts } from "./PrefabPage";
import { stillOf } from "./scene";
import type { PrefabFile } from "../../lib/prefab";

export interface Item {
  file: PrefabFile;
  facts: PrefabFacts;
}

export const TAGS = ["Decoration", "Obstacle", "Ramp", "Loop", "Scenery", "Structure"];
const FAKE = [
  "Loop gate",
  "Half pipe",
  "Chicane",
  "Spiral",
  "Kicker",
  "Funnel",
  "Bridge",
  "Bumpers",
  "Tower",
  "Ring",
];
const CREATORS = ["Will", "ChknThugget", "Lethal", "marbs", "Pinwheel"];

/* made-up favorites and tags until the database holds real ones */
export function sampleItems(prefabs: Array<Item>, many: boolean) {
  const n = many ? 24 : prefabs.length;
  return Array.from({ length: n }, (_, i) => {
    const base = prefabs[i % prefabs.length];
    const facts =
      i < prefabs.length
        ? base.facts
        : {
            ...base.facts,
            name: FAKE[i % FAKE.length] + (i >= 12 ? " II" : ""),
            creator: CREATORS[i % CREATORS.length],
            added: "2026-10-" + String(15 - (i % 14)).padStart(2, "0"),
          };
    return {
      ...base,
      facts,
      favs: [12, 31, 4, 0, 18, 7, 2, 25, 9, 1][i % 10] + (i >= 12 ? 0 : 3),
      tags:
        i % prefabs.length === 0
          ? ["Decoration", "Scenery"]
          : ["Ramp", "Structure"].slice(0, 1 + (i % 2)),
    };
  });
}

export function Still({ file, w = 480, h = 320 }: { file: PrefabFile; w?: number; h?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void stillOf(file, w, h).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [file, w, h]);
  return (
    <span className="pfl-still" style={{ aspectRatio: `${w} / ${h}` }}>
      {src && <img src={src} alt="" />}
    </span>
  );
}

export function Heart({ on }: { on?: boolean }) {
  return (
    <svg className={"pf-heart" + (on ? " on" : "")} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
    </svg>
  );
}

export function PrefabGallery({ prefabs }: { prefabs: Array<Item> }) {
  const params = useSearchParams();
  const all = useMemo(
    () => sampleItems(prefabs, params.get("state") === "many"),
    [prefabs, params],
  );
  const [sort, setSort] = useState<"popular" | "newest">("popular");
  const [tag, setTag] = useState<string | null>(null);
  const shown = all
    .filter((it) => !tag || it.tags.includes(tag))
    .sort((a, b) =>
      sort === "popular"
        ? b.favs - a.favs || b.facts.added.localeCompare(a.facts.added)
        : b.facts.added.localeCompare(a.facts.added),
    );
  return (
    <section className="pfl pfl-A">
      <header className="pfl-head pfl-headrow">
        <div>
          <h1>Prefabs</h1>
          <p>
            Ready-made pieces for the level editor. Download one, drop it in your Prefabs folder and
            spawn it into your map.
          </p>
        </div>
        <Link className="pf-dl" href="/prefabs/new">
          + Upload
        </Link>
      </header>
      <div className="pfl-bar">
        <div className="pfl-seg" role="group" aria-label="Sort">
          <button
            type="button"
            className={sort === "popular" ? "on" : ""}
            onClick={() => setSort("popular")}
          >
            Popular
          </button>
          <button
            type="button"
            className={sort === "newest" ? "on" : ""}
            onClick={() => setSort("newest")}
          >
            Newest
          </button>
        </div>
        <div className="pfl-tags">
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
        {shown.map((it, i) => (
          <Link key={i} className="pfl-card" href={"/prefab/" + it.facts.slug}>
            <Still file={it.file} />
            <span className="pfl-cardrow">
              <span className="pfl-name">{it.facts.name}</span>
              <span className="pfl-favs">
                <Heart on={i % 5 === 1} /> {it.favs}
              </span>
            </span>
            <span className="pfl-sub">
              by {it.facts.creator} · {it.facts.pieces} pieces
            </span>
          </Link>
        ))}
        {!shown.length && <p className="pfl-sub">No prefabs with that tag yet.</p>}
      </div>
    </section>
  );
}
