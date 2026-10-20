"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: grill-design for getting a Campaign's Maps from the Steam Workshop, with a
// how-to (claude/prototype-ws-links). Never merged: the winner is rebuilt by /implement-spec.
// ?variant= picks the design; ?view=phone frames the page at 390px.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type ProtoMap = { pfid: string; no: string; name: string | null; pic: string | null };

/* each variant is a pair: where a Campaign's Get button sits, and a Map page's how-to */
const VARIANTS = [
  ["A", "A · Button under the board card", "A · Steps under the button"],
  ["B", "B · Button by the Campaign switch", "B · How-to link opens the steps"],
  ["C", "C · A line above the board", "C · Renamed button + one line"],
  ["D", "D · First strip in the Map list", "D · ⓘ next to the button"],
  ["E", "E · Sticky button", "E · Button inside the steps"],
] as const;
type V = (typeof VARIANTS)[number][0];

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  addEventListener("popstate", l);
  return () => {
    listeners.delete(l);
    removeEventListener("popstate", l);
  };
};
const param = (k: string) =>
  typeof location === "undefined" ? null : new URLSearchParams(location.search).get(k);
export function useVariant(): V | null {
  const v = useSyncExternalStore(
    subscribe,
    () => param("variant") ?? "A",
    () => null,
  );
  if (v === null) return null;
  return VARIANTS.find((x) => x[0] === v)?.[0] ?? "A";
}

/* the only public Workshop collections holding a Campaign's Maps (2026-10-20) */
const COLLECTIONS: Record<string, string> = {
  "solar-trials": "3805419594",
  "velocity-trials": "3803939147",
  "mind-trials": "3821607033",
};
const ws = (pfid: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${pfid}`;

/* which Maps this browser has opened, per Campaign */
function useOpened(slug: string): [Set<string>, (pfid: string) => void, () => void] {
  const key = "proto-ws-" + slug;
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );
  const set = new Set(raw ? raw.split(",") : []);
  const save = (s: Set<string>) => {
    try {
      localStorage.setItem(key, [...s].join(","));
    } catch {}
    emit();
  };
  return [
    set,
    (p) => {
      set.add(p);
      save(set);
    },
    () => save(new Set()),
  ];
}

/* the how-to, in Will's four steps */
function Steps({ compact = false }: { compact?: boolean }) {
  const s = [
    ["Open it in the Steam Workshop", "Each Map's button below takes you there."],
    ["Press Subscribe", "Steam downloads it for you."],
    ["Go to the Hub in Ballest", "From the main menu."],
    ["Press the Downloads button", "Your subscribed Maps are there to play."],
  ];
  return (
    <ol className={compact ? "pws-steps compact" : "pws-steps"}>
      {s.map(([t, d], i) => (
        <li key={i}>
          <span className="pws-n">{i + 1}</span>
          <span>
            <b>{t}</b>
            {!compact && <small>{d}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function MapRow({
  m,
  opened,
  onOpen,
  tick,
}: {
  m: ProtoMap;
  opened: boolean;
  onOpen: () => void;
  tick?: boolean;
}) {
  return (
    <li className="pws-row" data-opened={tick && opened ? "" : undefined}>
      {m.pic ? <img src={m.pic} alt="" loading="lazy" /> : <span className="pws-nopic" />}
      <span className="pws-lab">
        <b>{m.no}</b>
        <span>{m.name ?? `Map ${m.no}`}</span>
      </span>
      <a className="pws-sub" href={ws(m.pfid)} target="_blank" rel="noopener" onClick={onOpen}>
        {tick && opened ? "✓ Opened" : "Subscribe ↗"}
      </a>
    </li>
  );
}

const OPEN = "pws-open";
const openGet = () => dispatchEvent(new Event(OPEN));

/* the checklist dialog, the same for every entry point */
function GetDialog({ slug, title, maps }: { slug: string; title: string; maps: ProtoMap[] }) {
  const [opened, open, reset] = useOpened(slug);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const show = () => dlg.current?.showModal();
    addEventListener(OPEN, show);
    return () => removeEventListener(OPEN, show);
  }, []);
  const col = COLLECTIONS[slug];
  return (
    <dialog
      ref={dlg}
      className="ptsx pws-dlg"
      onClick={(e) => e.target === dlg.current && dlg.current?.close()}
    >
      <div className="dh">
        <h2>Play {title} in Ballest</h2>
        <button type="button" onClick={() => dlg.current?.close()} aria-label="Close">
          ×
        </button>
      </div>
      {col && (
        <div className="pws-col">
          <a className="go" href={ws(col)} target="_blank" rel="noopener">
            Subscribe to all {maps.length} at once ↗
          </a>
          <small>Its Steam collection has a Subscribe to all button. Or one at a time:</small>
        </div>
      )}
      {!col && (
        <p className="pws-lead">
          Subscribe to each Map in the Steam Workshop, then open the Hub in Ballest and press
          Downloads.
        </p>
      )}
      <div className="pws-prog">
        <span>
          {opened.size} of {maps.length} opened
        </span>
        <i style={{ "--p": opened.size / maps.length } as React.CSSProperties} />
        {opened.size > 0 && (
          <button type="button" className="linkbtn pws-reset" onClick={reset}>
            Start over
          </button>
        )}
      </div>
      <ul className="pws-list">
        {maps.map((m) => (
          <MapRow key={m.pfid} m={m} tick opened={opened.has(m.pfid)} onOpen={() => open(m.pfid)} />
        ))}
      </ul>
      <h3 className="eyebrow">Then in Ballest</h3>
      <ol className="pws-steps compact">
        <li>
          <span className="pws-n">3</span>
          <b>Go to the Hub</b>
        </li>
        <li>
          <span className="pws-n">4</span>
          <b>Press the Downloads button</b>
        </li>
      </ol>
    </dialog>
  );
}

/* ---------- the Campaign's content column ---------- */
export function ProtoWsContent({
  slug,
  title,
  maps,
}: {
  slug: string;
  title: string;
  maps: ProtoMap[];
  makerId: string;
}) {
  const v = useVariant();
  if (!v) return null;
  const n = maps.length;
  return (
    <>
      <GetDialog slug={slug} title={title} maps={maps} />
      {v === "A" && (
        <button type="button" className="go pws-getbtn" onClick={openGet}>
          Get the {n} Maps
        </button>
      )}
      {v === "E" && (
        <button type="button" className="go pws-sticky" onClick={openGet}>
          <SteamMark /> Get the {n} Maps
        </button>
      )}
    </>
  );
}

/* B: beside the Campaign switch in the board row (phone), C: a line above the board row */
export function ProtoRowGet({ n, at }: { n: number; at: "row" | "above" }) {
  const v = useVariant();
  if (v === "B" && at === "row")
    return (
      <button type="button" className="pws-rowbtn" onClick={openGet}>
        <SteamMark /> Get Maps
      </button>
    );
  if (v === "C" && at === "above")
    return (
      <button type="button" className="pws-line" onClick={openGet}>
        <span>
          New to these Maps? <b>Get all {n} into Ballest</b>
        </span>
        <span aria-hidden>→</span>
      </button>
    );
  return null;
}

/* B: under the maker at the rail's head (desktop) */
export function ProtoRailHow({ n }: { n: number }) {
  const v = useVariant();
  if (v !== "B") return null;
  return (
    <button type="button" className="go pws-railget" onClick={openGet}>
      <SteamMark /> Get the {n} Maps
    </button>
  );
}

/* D: the first strip of the Map list, in the rail and the phone sheet */
export function ProtoRailGet({ n }: { n: number }) {
  const v = useVariant();
  if (v !== "D") return null;
  return (
    <button type="button" className="tstrip plain pws-strip" onClick={openGet}>
      <span className="lab">
        <b>Get</b> <small>all {n} Maps from the Steam Workshop</small>
      </span>
    </button>
  );
}

/* ---------- a Map's own page: the how-to by its Workshop button ---------- */
export function ProtoMapHow({ pfid }: { pfid: string }) {
  const v = useVariant();
  const dlg = useRef<HTMLDialogElement>(null);
  const [tip, setTip] = useState(false);
  if (!v) return null;
  const btn = (text = "Open in Steam Workshop") => (
    <a className="go mp-ws" href={ws(pfid)} target="_blank" rel="noopener">
      {text}
    </a>
  );
  if (v === "A")
    return (
      <div className="pws-mapA">
        {btn()}
        <Steps compact />
      </div>
    );
  if (v === "B")
    return (
      <div className="pws-mapB">
        {btn()}
        <button
          type="button"
          className="linkbtn pws-reset"
          onClick={() => dlg.current?.showModal()}
        >
          How do I play this in Ballest?
        </button>
        <dialog
          ref={dlg}
          className="ptsx pws-dlg"
          onClick={(e) => e.target === dlg.current && dlg.current?.close()}
        >
          <div className="dh">
            <h2>Getting a Map into Ballest</h2>
            <button type="button" onClick={() => dlg.current?.close()} aria-label="Close">
              ×
            </button>
          </div>
          <Steps />
          {btn()}
        </dialog>
      </div>
    );
  if (v === "C")
    return (
      <div className="pws-mapC">
        {btn("Get it in Ballest ↗")}
        <small>
          Press <b>Subscribe</b> on Steam, then in Ballest go to the <b>Hub</b> and press{" "}
          <b>Downloads</b>.
        </small>
      </div>
    );
  if (v === "D")
    return (
      <div className="pws-mapD">
        <div className="pws-mapD-row">
          {btn()}
          <button
            type="button"
            className="pws-i"
            aria-expanded={tip}
            aria-label="How to play it"
            onClick={() => setTip(!tip)}
          >
            i
          </button>
        </div>
        {tip && (
          <div className="pws-tip">
            <Steps compact />
          </div>
        )}
      </div>
    );
  return (
    <div className="pws-mapE">
      <h2 className="eyebrow">Play it in Ballest</h2>
      <ol className="pws-steps">
        <li>
          <span className="pws-n">1</span>
          {btn()}
        </li>
        <li>
          <span className="pws-n">2</span>
          <b>Press Subscribe</b>
        </li>
        <li>
          <span className="pws-n">3</span>
          <b>Go to the Hub in Ballest</b>
        </li>
        <li>
          <span className="pws-n">4</span>
          <b>Press Downloads</b>
        </li>
      </ol>
    </div>
  );
}

function SteamMark() {
  return (
    <svg className="pws-mark" viewBox="0 0 16 16" aria-hidden width="14" height="14">
      <path
        d="M9 2h5v5M14 2 7 9M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------- the picker: plainly not part of the design ---------- */
export function ProtoPicker() {
  const v = useVariant();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const go = (d: number) => {
    const i = VARIANTS.findIndex((x) => x[0] === v);
    const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length];
    const q = new URLSearchParams(location.search);
    q.set("variant", next[0]);
    history.replaceState(history.state, "", location.pathname + "?" + q.toString());
    emit();
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, dialog")) return;
      if (e.key === "ArrowLeft") goRef.current(-1);
      if (e.key === "ArrowRight") goRef.current(1);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  const view = useSyncExternalStore(
    subscribe,
    () => param("view"),
    () => null,
  );
  const framed = useSyncExternalStore(
    subscribe,
    () => window.top !== window || param("framed") === "1",
    () => false,
  );
  const href = useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search,
    () => "",
  );
  if (!v || framed) return null;
  const row = VARIANTS.find((x) => x[0] === v);
  const name = href.startsWith("/map/") ? row?.[2] : row?.[1];
  const phone = view === "phone";
  const toggle = () => {
    const q = new URLSearchParams(location.search);
    if (phone) q.delete("view");
    else q.set("view", "phone");
    history.replaceState(history.state, "", location.pathname + "?" + q.toString());
    emit();
  };
  const inner = (() => {
    const [path, query = ""] = href.split("?");
    const q = new URLSearchParams(query);
    q.delete("view");
    q.set("framed", "1");
    return path + "?" + q.toString();
  })();
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (m: PointerEvent) => setPos({ x: m.clientX - dx, y: m.clientY - dy });
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  return (
    <>
      {phone ? (
        <div className="proto-frame">
          <iframe key={inner} src={inner} title="Phone view" />
        </div>
      ) : null}
      <div
        ref={ref}
        className="proto-picker"
        onPointerDown={drag}
        style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      >
        <div className="pp-row">
          <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
            ←
          </button>
          <b>{name}</b>
          <button type="button" onClick={() => go(1)} aria-label="Next variant">
            →
          </button>
        </div>
        <div className="pp-row">
          <button type="button" aria-pressed={!phone} onClick={phone ? toggle : undefined}>
            Desktop
          </button>
          <button type="button" aria-pressed={phone} onClick={phone ? undefined : toggle}>
            Phone
          </button>
        </div>
      </div>
    </>
  );
}
