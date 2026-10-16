"use client";
/* ==========================================================================
   PROTOTYPE (grill-design round 2, claude/prototype-prefabs): five layouts for
   the Prefabs list at /prefabs, chosen by ?variant=, with ?state= for two or
   two dozen prefabs. Never merged.
   ========================================================================== */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Byline, Download, Parts, kb, metres, type PrefabFacts } from "./PrefabPage";
import { PrefabViewer } from "./PrefabViewer";
import { Picker } from "./Picker";
import { stillOf } from "./scene";
import type { PrefabFile } from "../../lib/prefab";

interface Item {
  file: PrefabFile;
  facts: PrefabFacts;
}

const VARIANTS = [
  ["A", "Gallery", "A grid of cards: a still picture, the name, creator and piece count"],
  ["B", "Hover to spin", "The same grid, but the card under the pointer turns live in 3D"],
  ["C", "Featured", "The newest prefab large and spinning with Download, the rest on a shelf"],
  ["D", "Browser", "A list on the left, the picked prefab live on the right (desktop)"],
  ["E", "Table", "Dense rows with a small picture and a Download on every row"],
] as const;
const STATES = [
  ["few", "2 prefabs"],
  ["many", "24 prefabs"],
] as const;

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

const href = (f: PrefabFacts) => "/prefab/" + f.slug;

function Still({ item, w = 480, h = 320 }: { item: Item; w?: number; h?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void stillOf(item.file, w, h).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [item.file, w, h]);
  return (
    <span className="pfl-still" style={{ aspectRatio: `${w} / ${h}` }}>
      {src && <img src={src} alt="" />}
    </span>
  );
}

export function ListPrototype({ prefabs }: { prefabs: Array<Item> }) {
  const params = useSearchParams();
  const variant = VARIANTS.find((v) => v[0] === params.get("variant"))?.[0] ?? "A";
  const state = params.get("state") === "many" ? "many" : "few";
  const items = useMemo(
    () =>
      state === "few"
        ? prefabs
        : Array.from({ length: 24 }, (_, i) => {
            const base = prefabs[i % prefabs.length];
            return i < prefabs.length
              ? base
              : {
                  ...base,
                  facts: {
                    ...base.facts,
                    name: FAKE[i % FAKE.length] + (i >= 12 ? " II" : ""),
                    creator: CREATORS[i % CREATORS.length],
                    added: "2026-10-" + String(15 - (i % 14)).padStart(2, "0"),
                  },
                };
          }),
    [prefabs, state],
  );
  return (
    <>
      <section className={"pfl pfl-" + variant}>
        <header className="pfl-head">
          <h1>Prefabs</h1>
          <p>
            Ready-made pieces for the level editor. Download one, drop it in your Prefabs folder and
            spawn it into your map.
          </p>
        </header>
        {variant === "A" && <Gallery items={items} />}
        {variant === "B" && <HoverGallery items={items} />}
        {variant === "C" && <Featured items={items} />}
        {variant === "D" && <Browser items={items} />}
        {variant === "E" && <Table items={items} />}
      </section>
      <Picker variants={VARIANTS} variant={variant} states={STATES} state={state} />
    </>
  );
}

function Card({ item, live }: { item: Item; live?: boolean }) {
  const f = item.facts;
  return (
    <Link className="pfl-card" href={href(f)}>
      {live ? (
        <span className="pfl-still">
          <PrefabViewer file={item.file} controls={false} className="pfv pfl-live" />
        </span>
      ) : (
        <Still item={item} />
      )}
      <span className="pfl-name">{f.name}</span>
      <span className="pfl-sub">
        by {f.creator} · {f.pieces} pieces
      </span>
    </Link>
  );
}

/* A · Gallery */
function Gallery({ items }: { items: Array<Item> }) {
  return (
    <div className="pfl-grid">
      {items.map((it, i) => (
        <Card key={i} item={it} />
      ))}
    </div>
  );
}

/* B · Hover to spin: one live viewer at a time, on the card under the pointer or focus */
function HoverGallery({ items }: { items: Array<Item> }) {
  const [on, setOn] = useState<number | null>(null);
  return (
    <div className="pfl-grid">
      {items.map((it, i) => (
        <div
          key={i}
          onPointerEnter={() => setOn(i)}
          onPointerLeave={() => setOn(null)}
          onFocus={() => setOn(i)}
        >
          <Card item={it} live={on === i} />
        </div>
      ))}
    </div>
  );
}

/* C · Featured */
function Featured({ items }: { items: Array<Item> }) {
  const [top, ...rest] = items;
  return (
    <>
      <article className="pfl-hero">
        <div className="pf-vwrap">
          <PrefabViewer file={top.file} />
        </div>
        <div className="pfl-hero-text">
          <p className="pf-kicker">Newest</p>
          <h2>
            <Link href={href(top.facts)}>{top.facts.name}</Link>
          </h2>
          <Byline facts={top.facts} />
          <p className="pf-desc">{top.facts.description}</p>
          <Parts facts={top.facts} />
          <div className="pfl-actions">
            <Download facts={top.facts} label={false} />
            <Link className="pfl-more" href={href(top.facts)}>
              Open
            </Link>
          </div>
        </div>
      </article>
      <h2 className="pfl-shelf-h">All prefabs</h2>
      <div className="pfl-shelf">
        {rest.map((it, i) => (
          <Card key={i} item={it} />
        ))}
      </div>
    </>
  );
}

/* D · Browser */
function Browser({ items }: { items: Array<Item> }) {
  const [pick, setPick] = useState(0);
  const cur = items[pick];
  return (
    <div className="pfl-browser">
      <ul className="pfl-list">
        {items.map((it, i) => (
          <li key={i}>
            <button type="button" className={i === pick ? "on" : ""} onClick={() => setPick(i)}>
              <Still item={it} w={96} h={72} />
              <span>
                <span className="pfl-name">{it.facts.name}</span>
                <span className="pfl-sub">
                  by {it.facts.creator} · {it.facts.pieces} pieces
                </span>
              </span>
            </button>
            <Link className="pfl-phone-link" href={href(it.facts)} aria-label={it.facts.name} />
          </li>
        ))}
      </ul>
      <div className="pfl-detail">
        <div className="pf-vwrap">
          <PrefabViewer key={pick} file={cur.file} />
        </div>
        <h2>
          <Link href={href(cur.facts)}>{cur.facts.name}</Link>
        </h2>
        <Byline facts={cur.facts} />
        <p className="pf-desc">{cur.facts.description}</p>
        <Download facts={cur.facts} label={false} />
      </div>
    </div>
  );
}

/* E · Table */
function Table({ items }: { items: Array<Item> }) {
  return (
    <table className="pfl-table">
      <thead>
        <tr>
          <th colSpan={2}>Prefab</th>
          <th className="pfl-wide">Pieces</th>
          <th className="pfl-wide">Size</th>
          <th className="pfl-wide">Added</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={i}>
            <td className="pfl-thumb">
              <Link href={href(it.facts)} tabIndex={-1}>
                <Still item={it} w={96} h={72} />
              </Link>
            </td>
            <td>
              <Link className="pfl-name" href={href(it.facts)}>
                {it.facts.name}
              </Link>
              <span className="pfl-sub">by {it.facts.creator}</span>
            </td>
            <td className="pfl-wide">{it.facts.pieces}</td>
            <td className="pfl-wide">
              {metres(it.facts.size.w)} × {metres(it.facts.size.d)}
            </td>
            <td className="pfl-wide">{it.facts.added}</td>
            <td className="pfl-dlcell">
              <a
                className="pfl-dlicon"
                href={it.facts.href}
                download={it.facts.filename}
                aria-label={"Download " + it.facts.name}
                title={kb(it.facts.bytes)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" />
                </svg>
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
