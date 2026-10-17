"use client";
// A Map's "See it in 3D" (spec #250): the button under its picture on the Map page, and the
// full screen it opens, a native <dialog> over the page (useDialog) holding the Map drawn by
// the Prefab viewer, a bar across the top with its name, maker and Close, and on a desktop a
// corner card with its record and Medal times. Only a Map whose file the site holds gets a
// button (`version`). The viewer, three.js and the file load only once it is pressed:
// MapModel is its own chunk and mounts only while the dialog is open.
import { Suspense, lazy, useRef, useState } from "react";

import { useDialog } from "../Modal";
import { MEDALS, fmtSec, fmtTime } from "../../lib/rules";

const MapModel = lazy(() => import("./MapModel"));

export function Map3D({
  pfid,
  version,
  title,
  creator,
  record,
  medals,
}: {
  pfid: string;
  /* the stored file's version (WorkshopMap.fileVersion) */
  version: string;
  title: string;
  creator: string;
  /* the record's score in ticks, or null with no time on the Map */
  record: number | null;
  /* [bronze, silver, gold, author], seconds */
  medals: Array<number>;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useDialog({ open, onClose: () => setOpen(false), from: button });
  return (
    <>
      <button ref={button} type="button" className="go m3d-open" onClick={() => setOpen(true)}>
        See it in 3D
      </button>
      <dialog className="m3d" aria-label={`${title} in 3D`} {...dialog.props}>
        {open && (
          <Suspense fallback={<MapWait />}>
            <MapModel pfid={pfid} version={version} />
          </Suspense>
        )}
        <header className="m3d-bar">
          <div>
            <b>{title}</b>
            <span>by {creator}</span>
          </div>
          <form method="dialog">
            <button className="m3d-close">Close</button>
          </form>
        </header>
        <dl className="m3d-card">
          <div>
            <dt>Record</dt>
            <dd>{record === null ? "None yet" : fmtTime(record)}</dd>
          </div>
          {MEDALS.map(([name, c, i]) => (
            <div key={name}>
              <dt>
                <i style={{ background: c }}></i>
                {name}
              </dt>
              <dd>{fmtSec(medals[i])}</dd>
            </div>
          ))}
        </dl>
        <p className="m3d-hint">Drag to turn · scroll or pinch to zoom</p>
      </dialog>
    </>
  );
}

export function MapWait({ failed = false }: { failed?: boolean }) {
  return (
    <div className="m3d-wait" aria-live="polite">
      {failed ? "Couldn't load the map." : "Building the map…"}
    </div>
  );
}
