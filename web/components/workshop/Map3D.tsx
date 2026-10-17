"use client";
// A Map's "See it in 3D" (spec #250): the button under its picture on the Map page, and the
// full screen it opens, a native <dialog> over the page (useDialog) holding the Map drawn by
// the Prefab viewer, a bar across the top with its name, maker and Close, and on a desktop a
// corner card under the bar with its record and Medal times. Only a Map whose file the site
// holds gets one (map3dOf). The dialog is a step in the history, so Back closes it. The
// viewer, three.js and the file load only once it is pressed: MapModel is its own chunk and
// mounts only while the dialog is open.
import { Suspense, lazy, useRef, useState } from "react";

import { useDialog } from "../Modal";
import { MapWait } from "./MapWait";
import { MedalList } from "./Medals";
import type { Map3DView } from "../../lib/workshop";

const MapModel = lazy(() => import("./MapModel"));

export function Map3D({ m }: { m: Map3DView }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useDialog({ open, onClose: () => setOpen(false), from: button, back: true });
  return (
    <>
      <button ref={button} type="button" className="go m3d-open" onClick={() => setOpen(true)}>
        See it in 3D
      </button>
      <dialog className="m3d" aria-label={`${m.title} in 3D`} {...dialog.props}>
        {open && (
          <Suspense fallback={<MapWait />}>
            <MapModel pfid={m.pfid} version={m.version} />
          </Suspense>
        )}
        <div className="m3d-top">
          <header className="m3d-bar">
            <div>
              <b>{m.title}</b>
              <span>by {m.creator}</span>
            </div>
            <form method="dialog">
              <button className="m3d-close">Close</button>
            </form>
          </header>
          <MedalList className="m3d-card" record={m.record ?? undefined} medals={m.medals} />
        </div>
        <p className="m3d-hint">Drag to turn · scroll or pinch to zoom</p>
      </dialog>
    </>
  );
}
