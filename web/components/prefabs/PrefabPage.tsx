"use client";
/* PROTOTYPE (grill-design, claude/prototype-prefabs): a Prefab's page as round 1 settled it:
   B · Sidebar, with A's piece chips, D's ? help dialog (open on a first visit) and a slow
   spin until the viewer is grabbed. Never merged. */
import { useEffect, useRef, useState } from "react";

import { PrefabViewer } from "./PrefabViewer";
import type { PrefabFile } from "../../lib/prefab";

export interface PrefabFacts {
  slug: string;
  name: string;
  creator: string;
  description: string;
  added: string;
  href: string;
  filename: string;
  bytes: number;
  pieces: number;
  parts: Array<{ piece: string; count: number }>;
  size: { w: number; d: number; h: number };
}

const FOLDER = "%LOCALAPPDATA%\\Ballest\\Saved\\SaveGames\\Prefabs";
const SEEN = "prefab-howto-seen";
export const metres = (m: number) => (m < 10 ? m.toFixed(1) : Math.round(m).toString()) + " m";
export const kb = (b: number) => Math.round(b / 1024) + " KB";
export const nice = (piece: string) =>
  piece
    .replace(/^BP_/, "")
    .replace(/_/g, " ")
    .replace(/\bPrim\b/, "")
    .replace(/(\D)(\d+)$/, "$1 $2")
    .trim();

export function Download({
  facts,
  big,
  label = true,
}: {
  facts: PrefabFacts;
  big?: boolean;
  label?: boolean;
}) {
  return (
    <a className={"pf-dl" + (big ? " big" : "")} href={facts.href} download={facts.filename}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" />
      </svg>
      Download {label && <span className="pf-fn">{facts.filename}</span>}
    </a>
  );
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pf-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Steps({ slug }: { slug: string }) {
  const cmd = "ballest.editor.spawnprefab " + slug;
  return (
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
  );
}

/* the ? on the viewer, and the how-to it opens; a first visit opens it once */
export function HelpDialog({ slug, first }: { slug: string; first: boolean }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN) === "1";
    } catch {}
    if (first && !seen) dlg.current?.showModal();
  }, [first]);
  const close = () => {
    try {
      localStorage.setItem(SEEN, "1");
    } catch {}
  };
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
        <Steps slug={slug} />
        <form method="dialog">
          <button className="pf-x">Got it</button>
        </form>
      </dialog>
    </>
  );
}

export function Byline({ facts }: { facts: PrefabFacts }) {
  return (
    <p className="pf-by">
      by <a href="#">{facts.creator}</a> · added {facts.added}
    </p>
  );
}

function Stats({ facts }: { facts: PrefabFacts }) {
  return (
    <dl className="pf-stats">
      <div>
        <dt>Pieces</dt>
        <dd>{facts.pieces}</dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd>
          {metres(facts.size.w)} × {metres(facts.size.d)} × {metres(facts.size.h)}
        </dd>
      </div>
      <div>
        <dt>File</dt>
        <dd>{kb(facts.bytes)}</dd>
      </div>
    </dl>
  );
}

export function Parts({ facts }: { facts: PrefabFacts }) {
  return (
    <ul className="pf-parts">
      {facts.parts.map((p) => (
        <li key={p.piece}>
          <span>{nice(p.piece)}</span>
          <b>×{p.count}</b>
        </li>
      ))}
    </ul>
  );
}

export function PrefabPage({
  file,
  facts,
  first = true,
}: {
  file: PrefabFile;
  facts: PrefabFacts;
  first?: boolean;
}) {
  const reset = (e: React.MouseEvent) =>
    e.currentTarget
      .closest(".pf-vwrap")
      ?.querySelector(".pfv")
      ?.dispatchEvent(new Event("prefab:home"));
  return (
    <div className="pf pf-B">
      <div className="pf-split">
        <div className="pf-vwrap">
          <PrefabViewer file={file} />
          <HelpDialog slug={facts.slug} first={first} />
          <div className="pf-tools">
            <button type="button" onClick={reset}>
              Reset view
            </button>
            <span className="pf-hint">Drag to turn · scroll to zoom</span>
          </div>
        </div>
        <aside className="pf-side">
          <h1>{facts.name}</h1>
          <Byline facts={facts} />
          <p className="pf-desc">{facts.description}</p>
          <Stats facts={facts} />
          <Parts facts={facts} />
          <Download facts={facts} big />
        </aside>
      </div>
    </div>
  );
}
