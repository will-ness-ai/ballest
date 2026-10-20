"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: grill-design for getting a Campaign's Maps from the Steam Workshop, with a
// how-to (claude/prototype-ws-links). Never merged: the winner is rebuilt by /implement-spec.
// ?variant= picks the design; ?view=phone frames the page at 390px.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type ProtoMap = { pfid: string; no: string; name: string | null; pic: string | null };

const VARIANTS = [
  ["A", "A · Get-the-Maps card under the board"],
  ["B", "B · Workshop button on each rail Map"],
  ["C", "C · Get button opens a checklist"],
  ["D", "D · Stepper, one Map at a time"],
  ["E", "E · One link for them all"],
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
const label = (m: ProtoMap) => (m.name ? `${m.no} · ${m.name}` : `Map ${m.no}`);

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

/* ---------- the Campaign's content column ---------- */
export function ProtoWsContent({
  slug,
  title,
  maps,
  makerId,
}: {
  slug: string;
  title: string;
  maps: ProtoMap[];
  makerId: string;
}) {
  const v = useVariant();
  const [opened, open, reset] = useOpened(slug);
  const dlg = useRef<HTMLDialogElement>(null);
  if (!v) return null;

  if (v === "A")
    return (
      <section className="pws-card">
        <h2 className="eyebrow">Play {title} in Ballest</h2>
        <Steps compact />
        <ul className="pws-list">
          {maps.map((m) => (
            <MapRow key={m.pfid} m={m} opened={opened.has(m.pfid)} onOpen={() => open(m.pfid)} />
          ))}
        </ul>
      </section>
    );

  if (v === "C")
    return (
      <>
        <button type="button" className="go pws-getbtn" onClick={() => dlg.current?.showModal()}>
          Get the {maps.length} Maps
        </button>
        <dialog
          ref={dlg}
          className="ptsx pws-dlg"
          onClick={(e) => e.target === dlg.current && dlg.current?.close()}
        >
          <div className="dh">
            <h2>Play {title} in Ballest</h2>
            <button
              type="button"
              className="pws-x"
              onClick={() => dlg.current?.close()}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p className="pws-lead">
            Subscribe to each Map in the Steam Workshop, then open the Hub in Ballest and press
            Downloads.
          </p>
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
              <MapRow
                key={m.pfid}
                m={m}
                tick
                opened={opened.has(m.pfid)}
                onOpen={() => open(m.pfid)}
              />
            ))}
          </ul>
          <h3 className="eyebrow">Then in Ballest</h3>
          <ol className="pws-steps compact" start={3}>
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
      </>
    );

  if (v === "D") {
    const next = maps.find((m) => !opened.has(m.pfid));
    const done = !next;
    return (
      <section className="pws-stepper">
        <ol className="pws-track">
          {["Workshop", "Subscribe", "Hub", "Downloads"].map((s, i) => (
            <li key={s} data-on={done ? i >= 2 : i < 2 ? "" : undefined}>
              <span className="pws-n">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        {next ? (
          <div className="pws-next">
            <span className="pws-nextpic">{next.pic ? <img src={next.pic} alt="" /> : null}</span>
            <span className="pws-nextlab">
              <small>
                Map {maps.indexOf(next) + 1} of {maps.length}
              </small>
              <b>{next.name ?? `Map ${next.no}`}</b>
            </span>
            <a
              className="go"
              href={ws(next.pfid)}
              target="_blank"
              rel="noopener"
              onClick={() => open(next.pfid)}
            >
              {opened.size === 0 ? "Open in Workshop ↗" : "Next Map ↗"}
            </a>
          </div>
        ) : (
          <p className="pws-done">
            All {maps.length} opened. In Ballest, go to the <b>Hub</b> and press <b>Downloads</b>.{" "}
            <button type="button" className="linkbtn" onClick={reset}>
              Start over
            </button>
          </p>
        )}
        <div className="pws-dots" aria-hidden>
          {maps.map((m) => (
            <i key={m.pfid} data-on={opened.has(m.pfid) ? "" : undefined} />
          ))}
        </div>
        <p className="pws-hint">
          Press Subscribe on each Steam page, then come back here for the next.
        </p>
      </section>
    );
  }

  if (v === "E") {
    const col = COLLECTIONS[slug];
    return (
      <section className="pws-one">
        {col ? (
          <a className="go" href={ws(col)} target="_blank" rel="noopener">
            Subscribe to all {maps.length} on Steam ↗
          </a>
        ) : (
          <a
            className="go"
            href={`https://steamcommunity.com/profiles/${makerId}/myworkshopfiles/?appid=3339810`}
            target="_blank"
            rel="noopener"
          >
            See all {maps.length} on the maker&apos;s Workshop page ↗
          </a>
        )}
        <p>
          {col ? "Press Subscribe to all on the collection, then" : "Subscribe to each there, then"}{" "}
          in Ballest go to the <b>Hub</b> and press <b>Downloads</b>.
        </p>
        <small>
          {col
            ? "This Campaign has a Steam collection, so one press subscribes to every Map."
            : "No Steam collection for this Campaign (only 3 of 22 have one), so this falls back to the maker's page."}
        </small>
      </section>
    );
  }

  /* B: the rail carries the buttons; the content keeps only a line to the how-to */
  return null;
}

/* ---------- B: on each rail Map, and a how-to under the maker ---------- */
export function ProtoRailWs({ pfid }: { pfid: string }) {
  const v = useVariant();
  if (v !== "B") return null;
  return (
    <a
      className="pws-railbtn"
      href={ws(pfid)}
      target="_blank"
      rel="noopener"
      aria-label="Open in Steam Workshop"
      title="Open in Steam Workshop"
    >
      <SteamMark />
    </a>
  );
}

export function ProtoRailHow() {
  const v = useVariant();
  const dlg = useRef<HTMLDialogElement>(null);
  if (v !== "B") return null;
  return (
    <>
      <button type="button" className="pws-how" onClick={() => dlg.current?.showModal()}>
        <SteamMark /> How to play these Maps
      </button>
      <dialog
        ref={dlg}
        className="ptsx pws-dlg"
        onClick={(e) => e.target === dlg.current && dlg.current?.close()}
      >
        <div className="dh">
          <h2>Getting a Map into Ballest</h2>
          <button
            type="button"
            className="pws-x"
            onClick={() => dlg.current?.close()}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <Steps />
        <p className="pws-lead">
          Each Map in the list has a <SteamMark /> button that opens it in the Workshop.
        </p>
      </dialog>
    </>
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
  const name = VARIANTS.find((x) => x[0] === v)?.[1];
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
