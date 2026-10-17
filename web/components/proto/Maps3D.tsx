"use client";
// ============================ PROTOTYPE (grill-design, maps3d) ============================
// Never merged: claude/prototype-maps3d only. Round 3: what the full-screen 3D map holds
// (?variant=A..E, ?state=open starts it open). The Map files are the .ballmap JSON fetched
// from Steam into /prototype-maps/<pfid>.ballmap by prototype-maps/fetch.py.
import { useEffect, useState } from "react";

import { useDialog } from "../Modal";
import { PrefabViewer, useViewer } from "../prefabs/PrefabViewer";
import { prefabOfBallmap, type BallmapFile } from "../../lib/ballmap";
import type { PrefabFile, PrefabItem } from "../../lib/prefab";
import type { PrefabAngle } from "../../lib/prefabs";
import { MEDALS, fmtSec, fmtTime } from "../../lib/rules";

export const VARIANTS: Array<[string, string, string]> = [
  ["A", "Bare", "just the map, Close and a hint (round 2's A, fixed)"],
  ["B", "Title bar", "the map's name, maker and Close across the top"],
  ["C", "Views", "Angled / From above / From the side buttons, and Reset"],
  ["D", "Start and finish", "glowing beacons over the start pad and each goal, with a key"],
  ["E", "Facts card", "a corner card with the record and Medals over the map"],
  ["F", "B + E", "Will's pick: title bar, and the facts card on desktop only"],
];

/* every Map whose file the prototype fetched */
export const HAS = new Set([
  "3796933002",
  "3802991891",
  "3816860716",
  "3810672947",
  "3810099846",
  "3809412387",
  "3810207749",
  "3798532776",
  "3799090646",
  "3816865675",
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

/* variant D: a tall glowing column over the start pad and each goal ring */
const beacon = (at: PrefabItem, material: string): PrefabItem => ({
  class: "Beacon",
  transform: {
    location: at.transform.location,
    rotation: [0, 0, 0],
    scale: [7, 7, 1.6],
  },
  meshes: [{ mesh: "SM_2000_Pipe", materials: [material] }],
});
function withBeacons(f: PrefabFile): PrefabFile {
  const extra: Array<PrefabItem> = [];
  for (const it of f.items) {
    if (/MP_PlayerStart/.test(it.class)) extra.push(beacon(it, "MI_Emissive_Red"));
    if (/BP_Checkpoint_C|Finish/.test(it.class)) extra.push(beacon(it, "MI_Emissive_Yellow"));
  }
  return { ...f, items: [...f.items, ...extra] };
}

const VIEWS: Record<string, PrefabAngle> = {
  Angled: { from: [0.58, 0.45, 0.68], zoom: 0.8, pan: [0, 0, 0] },
  "From above": { from: [0, 1, 0.0001], zoom: 0.75, pan: [0, 0, 0] },
  "From the side": { from: [1, 0.12, 0.2], zoom: 0.75, pan: [0, 0, 0] },
};

/* a tall screen fits a wide map only from further back */
const fit = (a: PrefabAngle): PrefabAngle =>
  typeof window !== "undefined" && innerWidth < innerHeight ? { ...a, zoom: a.zoom * 1.3 } : a;

export function Map3D({
  pfid,
  className,
  beacons = false,
  angle = null,
  attach,
}: {
  pfid: string;
  className?: string;
  beacons?: boolean;
  angle?: PrefabAngle | null;
  attach?: ReturnType<typeof useViewer>["attach"];
}) {
  const [file, setFile] = useState<PrefabFile | null>(null);
  useEffect(() => {
    let live = true;
    void loadMap(pfid).then((f) => live && setFile(beacons ? withBeacons(f) : f));
    return () => {
      live = false;
    };
  }, [pfid, beacons]);
  return file ? (
    <PrefabViewer
      file={file}
      className={className ?? "m3d"}
      angle={fit(angle ?? VIEWS.Angled)}
      attach={attach}
    />
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

export interface MapInfo {
  pfid: string;
  title: string;
  creator: string;
  medals: Array<number>;
  record: number;
}

/* the Map page's button and its full-screen map */
export function ProtoSlot({ m, slot }: { m: MapInfo; slot: string }) {
  const [open, setOpen] = useState(false);
  /* ?state=open starts the 3D view open, for screenshots */
  useEffect(() => {
    if (new URLSearchParams(location.search).get("state") === "open") setOpen(true); // eslint-disable-line react-hooks/set-state-in-effect -- PROTOTYPE
  }, []);
  if (slot !== "img" || !HAS.has(m.pfid)) return null;
  return (
    <>
      <button type="button" className="go m3d-dlink" onClick={() => setOpen(true)}>
        See it in 3D
      </button>
      <FullScreen m={m} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* a native <dialog> in the top layer, so nothing on the page can sit above it */
function FullScreen({ m, open, onClose }: { m: MapInfo; open: boolean; onClose: () => void }) {
  const v = useVariant();
  const dialog = useDialog({ open, onClose });
  const viewer = useViewer();
  const [view, setView] = useState("Angled");
  return (
    <dialog className={`m3d-full m3d-v${v}`} aria-label={`${m.title} in 3D`} {...dialog.props}>
      {open && (
        <Map3D
          key={v}
          pfid={m.pfid}
          className="m3d m3d-fill"
          beacons={v === "D"}
          angle={v === "C" ? VIEWS[view] : null}
          attach={viewer.attach}
        />
      )}
      {v === "B" || v === "F" ? (
        <header className="m3d-bar">
          <div>
            <b>{m.title}</b>
            <span>by {m.creator}</span>
          </div>
          <form method="dialog">
            <button className="m3d-close2">Close</button>
          </form>
        </header>
      ) : (
        <form method="dialog">
          <button className="m3d-close">Close</button>
        </form>
      )}
      {v === "C" && (
        <div className="m3d-views">
          {Object.keys(VIEWS).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={view === k}
              onClick={() => {
                setView(k);
                viewer.home();
              }}
            >
              {k}
            </button>
          ))}
          <button type="button" onClick={viewer.home}>
            Reset
          </button>
        </div>
      )}
      {v === "D" && (
        <div className="m3d-key">
          <span>
            <i className="k-start"></i>Start
          </span>
          <span>
            <i className="k-goal"></i>Finish
          </span>
        </div>
      )}
      {(v === "E" || v === "F") && (
        <aside className={v === "F" ? "m3d-card m3d-card-desk" : "m3d-card"}>
          <b>{m.title}</b>
          <dl>
            <div>
              <dt>Record</dt>
              <dd>{fmtTime(m.record)}</dd>
            </div>
            {MEDALS.map(([name, c, i]) => (
              <div key={name}>
                <dt>
                  <i style={{ background: c }}></i>
                  {name}
                </dt>
                <dd>{fmtSec(m.medals[i])}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
      <span className="m3d-hint">Drag to turn · scroll or pinch to zoom</span>
    </dialog>
  );
}
// ========================== end PROTOTYPE (grill-design, maps3d) ==========================
