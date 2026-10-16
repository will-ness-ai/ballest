"use client";
// A Prefab's viewer on its page: the file fetched from its download URL and drawn, the ?
// that opens the how-to (open on its own on a first visit), and Reset view.
import { useEffect, useRef, useState } from "react";

import { PrefabViewer } from "./PrefabViewer";
import type { PrefabFile } from "../../lib/prefab";

const FOLDER = "%LOCALAPPDATA%\\Ballest\\Saved\\SaveGames\\Prefabs";
const SEEN = "prefab-howto-seen";

export function PrefabModel({ src, name }: { src: string; name: string }) {
  const [file, setFile] = useState<PrefabFile | null>(null);
  const [failed, setFailed] = useState(false);
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    fetch(src)
      .then((r) => (r.ok ? (r.json() as Promise<PrefabFile>) : Promise.reject(new Error())))
      .then((f) => live && setFile(f))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [src]);
  return (
    <div className="pf-vwrap" ref={view}>
      {file ? (
        <PrefabViewer file={file} />
      ) : (
        <div className="pfv">
          {failed && <p className="pf-fail">Couldn&apos;t load the model.</p>}
        </div>
      )}
      <HelpDialog name={name} />
      <div className="pf-tools">
        <button
          type="button"
          onClick={() =>
            view.current?.querySelector(".pfv")?.dispatchEvent(new Event("prefab:home"))
          }
        >
          Reset view
        </button>
        <span className="pf-hint">Drag to turn · scroll to zoom</span>
      </div>
    </div>
  );
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pf-copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
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
   which is what spawnprefab takes */
function HelpDialog({ name }: { name: string }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!seen()) dlg.current?.showModal();
  }, []);
  const close = () => {
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      // storage blocked: the how-to opens on its own again next visit
    }
  };
  const cmd = "ballest.editor.spawnprefab " + name;
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
            <span className="pf-code">
              <code>{FOLDER}</code>
              <Copy text={FOLDER} />
            </span>
          </li>
          <li>
            <b>In the level editor</b>, open the console and run:
            <span className="pf-code">
              <code>{cmd}</code>
              <Copy text={cmd} />
            </span>
            It appears in front of the camera as one group.
          </li>
        </ol>
        <form method="dialog">
          <button className="pf-x">Got it</button>
        </form>
      </dialog>
    </>
  );
}
