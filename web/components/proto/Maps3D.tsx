"use client";
// ============================ PROTOTYPE (grill-design, maps3d) ============================
// Never merged: claude/prototype-maps3d only. The variants of "3D Workshop maps" and the
// picker that cycles them (?variant=A..E, ?state=...). The Map files are the .ballmap JSON
// fetched from Steam into /prototype-maps/<pfid>.ballmap by prototype-maps/fetch.py.
import { useEffect, useState } from "react";

import { PrefabViewer } from "../prefabs/PrefabViewer";
import { prefabOfBallmap, type BallmapFile } from "../../lib/ballmap";
import type { PrefabFile } from "../../lib/prefab";

/* Steam's Most Popular (ranked by vote) top ten on 2026-10-17 */
export const TOP10: Array<{ pfid: string; title: string }> = [
  { pfid: "3796933002", title: "Sway n So" },
  { pfid: "3802991891", title: "Brand New TV Offer v2" },
  { pfid: "3816860716", title: "Cube Void" },
  { pfid: "3810672947", title: "Ice Boat Race" },
  { pfid: "3810099846", title: "Crimson Flux" },
  { pfid: "3809412387", title: "Mirror's Edge" },
  { pfid: "3810207749", title: "Wallest" },
  { pfid: "3798532776", title: "SANDSTONE" },
  { pfid: "3799090646", title: "Jumping and bumping" },
  { pfid: "3816865675", title: "Sunken Ruins" },
];
export const rankOf = (pfid: string) => TOP10.findIndex((m) => m.pfid === pfid);

export const VARIANTS: Array<[string, string, string]> = [
  ["A", "Picture is 3D", "the panel's picture becomes the live 3D map"],
  ["B", "Stage", "a wide 3D band across the top of the Map page, above panel and board"],
  ["C", "View in 3D button", "a button on the picture opens the map full screen"],
  ["D", "Top 10 page", "a new page with the ten maps; the Map page links to it"],
  ["E", "Board | 3D tabs", "tabs above the board swap it for the 3D map"],
];

export function useVariant() {
  const [v, setV] = useState("A");
  useEffect(() => {
    const read = () => setV(new URLSearchParams(location.search).get("variant") ?? "A");
    read();
    addEventListener("proto-variant", read);
    return () => removeEventListener("proto-variant", read);
  }, []);
  return v;
}

const files = new Map<string, Promise<PrefabFile>>();
export function loadMap(pfid: string) {
  let f = files.get(pfid);
  if (!f) {
    f = fetch(`/prototype-maps/${pfid}.ballmap`)
      .then((r) => r.json() as Promise<BallmapFile>)
      .then(prefabOfBallmap);
    files.set(pfid, f);
  }
  return f;
}

export function Map3D({
  pfid,
  className,
  spin = true,
}: {
  pfid: string;
  className?: string;
  spin?: boolean;
}) {
  const [file, setFile] = useState<PrefabFile | null>(null);
  useEffect(() => {
    let live = true;
    void loadMap(pfid).then((f) => live && setFile(f));
    return () => {
      live = false;
    };
  }, [pfid]);
  return file ? (
    <PrefabViewer file={file} className={className ?? "m3d"} spin={spin} />
  ) : (
    <div className={(className ?? "m3d") + " m3d-wait"}>Building the map…</div>
  );
}

export function Picker() {
  const v = useVariant();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const go = (d: number) => {
    const i = VARIANTS.findIndex(([k]) => k === v);
    const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length][0];
    const u = new URL(location.href);
    u.searchParams.set("variant", next);
    history.replaceState(history.state, "", u);
    dispatchEvent(new Event("proto-variant"));
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });
  const cur = VARIANTS.find(([k]) => k === v) ?? VARIANTS[0];
  return (
    <div
      className="proto-pick"
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const r = e.currentTarget.getBoundingClientRect();
        const dx = e.clientX - r.left;
        const dy = e.clientY - r.top;
        const move = (m: PointerEvent) => setPos({ x: m.clientX - dx, y: m.clientY - dy });
        const up = () => {
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", up);
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
      }}
    >
      <button type="button" onClick={() => go(-1)}>
        ←
      </button>
      <span title={cur[2]}>
        <b>
          {cur[0]} · {cur[1]}
        </b>
        <small>{cur[2]}</small>
      </span>
      <button type="button" onClick={() => go(1)}>
        →
      </button>
    </div>
  );
}

/* the Map page's hooks: each renders only under its variant, and only for a top-ten Map */
export function ProtoSlot({ pfid, slot }: { pfid: string; slot: "img" | "stage" | "tabs" }) {
  const v = useVariant();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"board" | "3d">("board");
  const rank = rankOf(pfid);
  useEffect(() => {
    document.documentElement.classList.toggle("proto-3dtab", v === "E" && tab === "3d");
    document.documentElement.classList.toggle("proto-hideimg", rank >= 0 && v === "A");
  }, [v, tab, rank]);
  if (rank < 0) return null;
  if (slot === "img" && v === "A")
    return (
      <div className="m3d-a">
        <Map3D pfid={pfid} />
        <span className="m3d-badge">#{rank + 1} most popular · drag to turn</span>
      </div>
    );
  if (slot === "img" && v === "C")
    return (
      <>
        <button type="button" className="m3d-cbtn" onClick={() => setOpen(true)}>
          View in 3D
        </button>
        {open && (
          <div className="m3d-full" role="dialog">
            <Map3D pfid={pfid} className="m3d m3d-fill" />
            <button type="button" className="m3d-close" onClick={() => setOpen(false)}>
              Close
            </button>
            <span className="m3d-hint">Drag to turn · scroll to zoom · right-drag to pan</span>
          </div>
        )}
      </>
    );
  if (slot === "img" && v === "D")
    return (
      <a className="go m3d-dlink" href={`/maps3d?variant=D#${pfid}`}>
        See it in 3D · #{rank + 1} of the top 10
      </a>
    );
  if (slot === "stage" && v === "B")
    return (
      <div className="m3d-stage">
        <Map3D pfid={pfid} className="m3d m3d-fill" />
        <span className="m3d-badge">#{rank + 1} most popular · drag to turn</span>
      </div>
    );
  if (slot === "tabs" && v === "E")
    return (
      <div className="m3d-tabs">
        <div className="m3d-tabbar" role="tablist">
          <button type="button" aria-selected={tab === "board"} onClick={() => setTab("board")}>
            Board
          </button>
          <button type="button" aria-selected={tab === "3d"} onClick={() => setTab("3d")}>
            3D map
          </button>
        </div>
        {tab === "3d" && <Map3D pfid={pfid} className="m3d m3d-tab" />}
      </div>
    );
  return null;
}

/* variant D's page: one big viewer and the ten Maps beside it */
export function Top10Page() {
  const [pfid, setPfid] = useState(TOP10[0].pfid);
  useEffect(() => {
    const h = location.hash.slice(1);
    if (rankOf(h) >= 0) setPfid(h);
  }, []);
  const m = TOP10[rankOf(pfid)];
  return (
    <div className="m3d-page">
      <header>
        <span className="eyebrow">Workshop in 3D</span>
        <h1>The ten most popular maps</h1>
      </header>
      <div className="m3d-pgrid">
        <div className="m3d-pview">
          <Map3D key={pfid} pfid={pfid} className="m3d m3d-fill" />
          <div className="m3d-pcap">
            <b>
              #{rankOf(pfid) + 1} {m.title}
            </b>
            <a href={`/map/${pfid}`}>Board →</a>
          </div>
        </div>
        <ol className="m3d-rail">
          {TOP10.map((t, i) => (
            <li key={t.pfid}>
              <button
                type="button"
                aria-current={t.pfid === pfid}
                onClick={() => {
                  setPfid(t.pfid);
                  history.replaceState(null, "", `#${t.pfid}`);
                }}
              >
                <span>{i + 1}</span>
                {t.title}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
// ========================== end PROTOTYPE (grill-design, maps3d) ==========================
