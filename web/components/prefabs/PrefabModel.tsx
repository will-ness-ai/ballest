"use client";
// A Prefab's viewer on its page: the file fetched from its download URL and drawn from its
// angle, the ? that opens the how-to (components/prefabs/HowTo, open on its own on a first
// visit), and Reset view, back to the angle (its uploader picks the angle in Edit).
import { useEffect, useState } from "react";

import { fetchPrefabFile } from "./file";
import { HelpDialog } from "./HowTo";
import { PrefabViewer, useViewer } from "./PrefabViewer";
import type { PrefabFile } from "../../lib/prefab";
import type { PrefabAngle } from "../../lib/prefabs";

export function PrefabModel({
  src,
  name,
  angle,
}: {
  src: string;
  name: string;
  angle: PrefabAngle | null;
}) {
  const [file, setFile] = useState<PrefabFile | null>(null);
  const [failed, setFailed] = useState(false);
  const { attach, home } = useViewer();
  useEffect(() => {
    let live = true;
    fetchPrefabFile(src)
      .then((f) => live && setFile(f))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [src]);
  return (
    <div className="pf-vwrap">
      {file ? (
        <PrefabViewer file={file} angle={angle} attach={attach} />
      ) : (
        <div className="pfv">
          {failed && <p className="pf-fail">Couldn&apos;t load the model.</p>}
        </div>
      )}
      <HelpDialog name={name} />
      <div className="pf-tools">
        <button type="button" onClick={home}>
          Reset view
        </button>
        <span className="pf-hint">Drag to turn · scroll to zoom</span>
      </div>
    </div>
  );
}
