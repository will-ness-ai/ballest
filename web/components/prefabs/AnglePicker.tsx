"use client";
// Where an uploader picks a Prefab's angle, on the upload form and in the Edit dialog: a line
// saying what to do, the preview held still so they can turn it, and Use this view, which
// makes the view they've turned to the angle (Default view puts it back). Once picked, the
// button says so until they turn the model again.
import { useState } from "react";

import { PrefabViewer, useViewer } from "./PrefabViewer";
import type { PrefabFile } from "../../lib/prefab";
import type { PrefabAngle } from "../../lib/prefabs";

export function AnglePicker({
  file,
  angle,
  onPick,
  className = "",
}: {
  file: PrefabFile;
  angle: PrefabAngle | null;
  onPick: (angle: PrefabAngle | null) => void;
  className?: string;
}) {
  const { attach, angleNow } = useViewer();
  /* whether the preview still shows the angle picked: true for one already set */
  const [showing, setShowing] = useState(angle !== null);
  const pick = (a: PrefabAngle | null) => {
    onPick(a);
    setShowing(a !== null);
  };
  return (
    <div className="pfa">
      <p className="pfa-note">
        Turn the model to the angle you want on its card, then press <b>Use this view</b>.
      </p>
      <div className={"pf-vwrap " + className}>
        <PrefabViewer
          file={file}
          spin={false}
          angle={angle}
          attach={attach}
          onTurn={() => setShowing(false)}
        />
        <div className="pf-tools">
          <span className="pf-hint">Drag to turn · scroll to zoom</span>
          <span className="pf-tools-end">
            {angle && (
              <button type="button" onClick={() => pick(null)}>
                Default view
              </button>
            )}
            <button
              type="button"
              aria-pressed={showing}
              onClick={() => {
                const a = angleNow();
                if (a) pick(a);
              }}
            >
              {showing ? "✓ Card uses this view" : "Use this view"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
