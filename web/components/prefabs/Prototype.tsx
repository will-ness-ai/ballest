"use client";
/* ==========================================================================
   PROTOTYPE (grill-design round 1, claude/prototype-prefabs): five layouts for
   a Prefab's page, chosen by ?variant=, plus the floating picker. Never merged.
   ========================================================================== */
import { useSearchParams } from "next/navigation";
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

const VARIANTS = [
  ["A", "Stage", "Wide viewer first, facts and Download under it, the how-to as a card below"],
  ["B", "Sidebar", "Viewer left, a side panel with facts, Download and the how-to steps"],
  ["C", "Header card", "A Map-page style header with Download; how-to as a banner on top"],
  ["D", "Immersive", "Viewer fills the screen; facts float over it; how-to is a ? dialog"],
  ["E", "Spec sheet", "Small viewer beside the parts list and file facts; steps inline"],
] as const;
type Key = (typeof VARIANTS)[number][0];
const STATES = [
  ["first", "First visit"],
  ["dismissed", "How-to dismissed"],
] as const;

const FOLDER = "%LOCALAPPDATA%\\Ballest\\Saved\\SaveGames\\Prefabs";
const metres = (m: number) => (m < 10 ? m.toFixed(1) : Math.round(m).toString()) + " m";
const kb = (b: number) => Math.round(b / 1024) + " KB";
const nice = (piece: string) =>
  piece
    .replace(/^BP_/, "")
    .replace(/_/g, " ")
    .replace(/\bPrim\b/, "")
    .replace(/(\D)(\d+)$/, "$1 $2")
    .trim();

export function Prototype({ file, facts }: { file: PrefabFile; facts: PrefabFacts }) {
  const params = useSearchParams();
  const variant = (VARIANTS.find((v) => v[0] === params.get("variant"))?.[0] ?? "A") as Key;
  const state = params.get("state") === "dismissed" ? "dismissed" : "first";
  const [hidden, setHidden] = useState(state === "dismissed");
  useEffect(() => setHidden(state === "dismissed"), [state]);
  const p = { file, facts, hidden, hide: () => setHidden(true), show: () => setHidden(false) };
  return (
    <>
      <div className={"pf pf-" + variant}>
        {variant === "A" && <Stage {...p} />}
        {variant === "B" && <Sidebar {...p} />}
        {variant === "C" && <HeaderCard {...p} />}
        {variant === "D" && <Immersive {...p} />}
        {variant === "E" && <SpecSheet {...p} />}
      </div>
      <Picker variant={variant} state={state} />
    </>
  );
}

interface P {
  file: PrefabFile;
  facts: PrefabFacts;
  hidden: boolean;
  hide: () => void;
  show: () => void;
}

function Download({ facts, big }: { facts: PrefabFacts; big?: boolean }) {
  return (
    <a className={"pf-dl" + (big ? " big" : "")} href={facts.href} download={facts.filename}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" />
      </svg>
      Download <span className="pf-fn">{facts.filename}</span>
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

function Steps({ facts, compact }: { facts: PrefabFacts; compact?: boolean }) {
  const cmd = "ballest.editor.spawnprefab " + facts.slug;
  return (
    <ol className={"pf-steps" + (compact ? " compact" : "")}>
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

function HowTo({ facts, hidden, hide, show, compact }: P & { compact?: boolean }) {
  if (hidden)
    return (
      <button type="button" className="pf-howlink" onClick={show}>
        How do I use a prefab?
      </button>
    );
  return (
    <section className="pf-how">
      <header>
        <h2>Using a prefab</h2>
        <button type="button" className="pf-x" onClick={hide} aria-label="Got it, hide this">
          Got it
        </button>
      </header>
      <Steps facts={facts} compact={compact} />
    </section>
  );
}

function Byline({ facts }: { facts: PrefabFacts }) {
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

function Parts({ facts }: { facts: PrefabFacts }) {
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

function Toolbar() {
  const reset = (e: React.MouseEvent) =>
    e.currentTarget
      .closest(".pf-vwrap")
      ?.querySelector(".pfv")
      ?.dispatchEvent(new Event("prefab:home"));
  return (
    <div className="pf-tools">
      <button type="button" onClick={reset}>
        Reset view
      </button>
      <span className="pf-hint">Drag to turn · scroll to zoom</span>
    </div>
  );
}

/* A · Stage */
function Stage(p: P) {
  return (
    <>
      <div className="pf-vwrap">
        <PrefabViewer file={p.file} />
        <Toolbar />
      </div>
      <div className="pf-row">
        <div>
          <h1>{p.facts.name}</h1>
          <Byline facts={p.facts} />
          <p className="pf-desc">{p.facts.description}</p>
        </div>
        <Download facts={p.facts} big />
      </div>
      <Parts facts={p.facts} />
      <HowTo {...p} />
    </>
  );
}

/* B · Sidebar */
function Sidebar(p: P) {
  return (
    <div className="pf-split">
      <div className="pf-vwrap">
        <PrefabViewer file={p.file} />
        <Toolbar />
      </div>
      <aside className="pf-side">
        <h1>{p.facts.name}</h1>
        <Byline facts={p.facts} />
        <p className="pf-desc">{p.facts.description}</p>
        <Stats facts={p.facts} />
        <Download facts={p.facts} big />
        <HowTo {...p} compact />
      </aside>
    </div>
  );
}

/* C · Header card */
function HeaderCard(p: P) {
  return (
    <>
      {!p.hidden && (
        <div className="pf-banner">
          <span>
            New to prefabs? Drop the file in your <b>Prefabs</b> folder, then run{" "}
            <code>ballest.editor.spawnprefab {p.facts.slug}</code> in the editor console.
          </span>
          <button type="button" className="pf-x" onClick={p.hide}>
            Got it
          </button>
        </div>
      )}
      <header className="pf-head">
        <div>
          <p className="pf-kicker">Prefab</p>
          <h1>{p.facts.name}</h1>
          <Byline facts={p.facts} />
        </div>
        <Download facts={p.facts} />
      </header>
      <p className="pf-desc">{p.facts.description}</p>
      <div className="pf-vwrap card">
        <PrefabViewer file={p.file} />
        <Toolbar />
      </div>
      <Stats facts={p.facts} />
    </>
  );
}

/* D · Immersive */
function Immersive(p: P) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!p.hidden) dlg.current?.showModal();
  }, [p.hidden]);
  return (
    <div className="pf-vwrap full">
      <PrefabViewer file={p.file} autoRotate />
      <div className="pf-glass">
        <h1>{p.facts.name}</h1>
        <Byline facts={p.facts} />
        <p className="pf-meta">
          {p.facts.pieces} pieces · {kb(p.facts.bytes)}
        </p>
        <Download facts={p.facts} big />
      </div>
      <button
        type="button"
        className="pf-q"
        onClick={() => dlg.current?.showModal()}
        aria-label="How to use a prefab"
      >
        ?
      </button>
      <dialog ref={dlg} className="pf-dialog" onClose={p.hide}>
        <h2>Using a prefab</h2>
        <Steps facts={p.facts} />
        <form method="dialog">
          <button className="pf-x">Got it</button>
        </form>
      </dialog>
    </div>
  );
}

/* E · Spec sheet */
function SpecSheet(p: P) {
  return (
    <>
      <header className="pf-head">
        <div>
          <h1>{p.facts.name}</h1>
          <Byline facts={p.facts} />
        </div>
        <Download facts={p.facts} />
      </header>
      <div className="pf-sheet">
        <div className="pf-vwrap square">
          <PrefabViewer file={p.file} />
        </div>
        <div>
          <p className="pf-desc">{p.facts.description}</p>
          <h2 className="pf-h2">Made of</h2>
          <table className="pf-table">
            <tbody>
              {p.facts.parts.map((x) => (
                <tr key={x.piece}>
                  <td>{nice(x.piece)}</td>
                  <td>{x.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Stats facts={p.facts} />
        </div>
      </div>
      <HowTo {...p} />
    </>
  );
}

function Picker({ variant, state }: { variant: Key; state: string }) {
  const i = VARIANTS.findIndex((v) => v[0] === variant);
  const go = (patch: Record<string, string>) => {
    const u = new URL(location.href);
    for (const [k, v] of Object.entries(patch)) u.searchParams.set(k, v);
    history.replaceState(null, "", u);
    location.reload();
  };
  const step = (d: number) =>
    go({ variant: VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length][0] });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });
  const v = VARIANTS[i];
  /* drag it anywhere by its middle line */
  const drag = (e: React.PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.closest<HTMLElement>(".proto-picker");
    if (!box || (e.target as HTMLElement).closest("button")) return;
    const r = box.getBoundingClientRect();
    const [dx, dy] = [e.clientX - r.left, e.clientY - r.top];
    const move = (m: PointerEvent) => {
      box.style.left = m.clientX - dx + "px";
      box.style.top = m.clientY - dy + "px";
      box.style.right = box.style.bottom = "auto";
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", () => removeEventListener("pointermove", move), { once: true });
  };
  return (
    <div className="proto-picker" role="region" aria-label="Prototype picker" onPointerDown={drag}>
      <div className="pp-row">
        <button type="button" onClick={() => step(-1)}>
          ←
        </button>
        <b>
          {v[0]} · {v[1]}
        </b>
        <button type="button" onClick={() => step(1)}>
          →
        </button>
      </div>
      <p>{v[2]}</p>
      <div className="pp-row">
        {STATES.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={k === state ? "on" : ""}
            onClick={() => go({ state: k })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
