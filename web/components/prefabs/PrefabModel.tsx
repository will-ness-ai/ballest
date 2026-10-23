"use client";
// A Prefab's viewer on its page: the file fetched from its download URL and drawn from its
// angle, the ? that opens the how-to (open on its own on a first visit), and Reset view, back
// to the angle (its uploader picks the angle in Edit).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Code } from "./Code";
import { fetchPrefabFile } from "./file";
import { PrefabViewer, useViewer } from "./PrefabViewer";
import type { PrefabFile } from "../../lib/prefab";
import { FOLDER, SPAWN } from "../../lib/prefab-console";
import type { PrefabAngle } from "../../lib/prefabs";
import { prefabGuideHref } from "../../lib/routes";

const SEEN = "prefab-howto-seen";

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

function seen() {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

/* the ? on the viewer and the how-to it opens; `name` is the download's name without .json,
   which is what spawnprefab takes. With `auto` it opens on its own once per browser */
export function HelpDialog({ name, auto = true }: { name: string; auto?: boolean }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (auto && !seen()) dlg.current?.showModal();
  }, [auto]);
  const close = () => {
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      // storage blocked: the how-to opens on its own again next visit
    }
  };
  const cmd = SPAWN + " " + name;
  return (
    <>
      <button
        type="button"
        className="pf-q"
        onClick={() => dlg.current?.showModal()}
        aria-label="How to use a prefab"
      >
        ?
      </button>
      <dialog ref={dlg} className="pf-dialog" onClose={close}>
        <h2>Using a prefab</h2>
        <ol className="pf-steps">
          <li>
            <b>Download</b> the file.
          </li>
          <li>
            <b>Put it in</b> your Prefabs folder:
            <Code text={FOLDER} />
          </li>
          <li>
            <b>In the level editor</b>, open the console with the <kbd>`</kbd> key and type:
            <Code text={cmd} />
            It appears in front of the camera as one group.
          </li>
        </ol>
        <form method="dialog">
          <Link href={prefabGuideHref()} onClick={() => dlg.current?.close()}>
            Making and sharing your own
          </Link>
          <button className="pf-x">Got it</button>
        </form>
      </dialog>
    </>
  );
}
