"use client";
// The Map in 3D inside its full screen (Map3D): its file read from /map/<pfid>/file at the
// version the page holds, turned into a Prefab file (lib/ballmap.ts) and drawn by the Prefab
// viewer from MAP_ANGLE. Its own chunk, loaded when the button is pressed, with three.js
// behind it.
import { useEffect, useState } from "react";

import { MapWait } from "./MapWait";
import { PrefabViewer } from "../prefabs/PrefabViewer";
import { prefabOfBallmap, type BallmapFile } from "../../lib/ballmap";
import type { PrefabFile } from "../../lib/prefab";
import type { PrefabAngle } from "../../lib/prefabs";
import { mapFileHref } from "../../lib/routes";

/* The view a Map opens on: the prototype's "Angled" view, which Will approved in its fourth
   round (claude/prototype-maps3d), three-quarters from above and closer than the Prefab
   default, so the Map fills more of the screen. On a screen taller than wide the camera
   starts TALL_ZOOM further back, so a wide Map isn't cropped at the sides. */
const MAP_ANGLE: PrefabAngle = { from: [0.58, 0.45, 0.68], zoom: 0.8, pan: [0, 0, 0] };
const TALL_ZOOM = 1.3;

/* each file read once per page, so closing and opening again draws at once */
const files = new Map<string, Promise<PrefabFile>>();
function loadMap(href: string) {
  let f = files.get(href);
  if (!f) {
    f = fetch(href)
      .then((r) =>
        r.ok ? (r.json() as Promise<BallmapFile>) : Promise.reject(new Error(String(r.status))),
      )
      .then(prefabOfBallmap);
    /* a failed read is tried again on the next open */
    f.catch(() => files.delete(href));
    files.set(href, f);
  }
  return f;
}

const fit = (): PrefabAngle =>
  innerWidth < innerHeight ? { ...MAP_ANGLE, zoom: MAP_ANGLE.zoom * TALL_ZOOM } : MAP_ANGLE;

export default function MapModel({ pfid, version }: { pfid: string; version: string }) {
  const [file, setFile] = useState<PrefabFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [angle] = useState(fit);
  useEffect(() => {
    let live = true;
    loadMap(mapFileHref(pfid, version))
      .then((f) => live && setFile(f))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [pfid, version]);
  /* the wait stays until the viewer has drawn (its data-ready hides it, maps.css): a big
     Map takes a moment to build after its file arrives */
  return (
    <>
      {file && <PrefabViewer file={file} className="m3d-view" angle={angle} />}
      <MapWait failed={failed} />
    </>
  );
}
