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
  ["A", "Full screen", "the button opens the map over the whole page"],
  ["B", "Own page", "the button goes to the map's own 3D page"],
  ["C", "In the panel", "the picture turns into the 3D map where it is"],
  ["D", "In the board's place", "the board column swaps to the 3D map"],
  ["E", "Drawer", "a sheet slides up (phone) or in from the side (desktop)"],
];

/* every Map whose file the prototype fetched */
export const HAS = new Set([
  ...TOP10.map((m) => m.pfid),
  "3755236154",
  "3762695115",
  "3796494598",
  "3805044786",
  "3805306900",
  "3806993482",
  "3808173247",
  "3820471145",
]);

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

/* the Map page's hooks: each renders only under its variant, and only for a Map with a file */
export function ProtoSlot({ pfid, slot }: { pfid: string; slot: "img" | "stage" | "tabs" }) {
  const v = useVariant();
  const [open, setOpen] = useState(false);
  /* ?state=open starts the 3D view open, for screenshots */
  useEffect(() => {
    if (new URLSearchParams(location.search).get("state") === "open") setOpen(true); // eslint-disable-line react-hooks/set-state-in-effect -- PROTOTYPE
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("proto-3dtab", v === "D" && open);
    document.documentElement.classList.toggle("proto-hideimg", v === "C" && open);
  }, [v, open]);
  if (!HAS.has(pfid)) return null;
  const button = (label = "See it in 3D") => (
    <button type="button" className="go m3d-dlink" onClick={() => setOpen(true)}>
      {label}
    </button>
  );
  if (slot === "img") {
    if (v === "B")
      return (
        <a className="go m3d-dlink" href={`/maps3d?variant=B#${pfid}`}>
          See it in 3D
        </a>
      );
    if (v === "A")
      return (
        <>
          {button()}
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
    if (v === "C")
      return open ? (
        <div className="m3d-a">
          <Map3D pfid={pfid} />
          <button type="button" className="m3d-x" onClick={() => setOpen(false)}>
            Picture
          </button>
        </div>
      ) : (
        button()
      );
    if (v === "D") return open ? null : button();
    if (v === "E")
      return (
        <>
          {button()}
          {open && (
            <div className="m3d-sheet" role="dialog">
              <div className="m3d-sheet-head">
                <b>3D map</b>
                <button type="button" className="m3d-x2" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
              <Map3D pfid={pfid} className="m3d m3d-fill" />
            </div>
          )}
        </>
      );
  }
  if (slot === "tabs" && v === "D" && open)
    return (
      <div className="m3d-tabs">
        <button type="button" className="m3d-back" onClick={() => setOpen(false)}>
          ← Back to the board
        </button>
        <Map3D pfid={pfid} className="m3d m3d-tab" />
      </div>
    );
  return null;
}

/* variant B's page: the Map's own 3D page */
export function Top10Page() {
  const [pfid, setPfid] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  useEffect(() => {
    const h = location.hash.slice(1);
    setPfid(h); // eslint-disable-line react-hooks/set-state-in-effect -- PROTOTYPE
    setTitle(TOP10.find((m) => m.pfid === h)?.title ?? "");
  }, []);
  if (!pfid) return null;
  return (
    <div className="m3d-page">
      <a className="back" href={`/map/${pfid}?variant=B`}>
        ← Board
      </a>
      <header>
        <span className="eyebrow">Workshop map in 3D</span>
        <h1>{title || "Map"}</h1>
      </header>
      <div className="m3d-pview">
        <Map3D pfid={pfid} className="m3d m3d-fill" />
        <span className="m3d-hint2">Drag to turn · scroll to zoom · right-drag to pan</span>
      </div>
    </div>
  );
}
// ========================== end PROTOTYPE (grill-design, maps3d) ==========================
