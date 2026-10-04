"use client";
// All maps: every Map with a time, in one of the ready-made views (each its own link,
// /maps/<view>) or narrowed further in the Refine panel, sixty at a time. The panel's
// choices live in this page only; a view's link starts it over from its preset.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { MapGrid } from "./Card";
import { BackLink } from "../BackLink";
import { useModalKeys } from "../Behaviours";
import { useClock } from "../../lib/client";
import { homeHref, mapsHref } from "../../lib/routes";
import { plural } from "../../lib/rules";
import {
  FILTERS,
  FILTER_KEYS,
  MAPS_CHUNK,
  NO_FILTER,
  SORTS,
  VIEWS,
  activeFilters,
  filteredMaps,
  refineFor,
  sameRefine,
  type MapCard,
  type Refine,
  type SortKey,
} from "../../lib/workshop";

function Drawer({
  f,
  n,
  set,
  reset,
  close,
}: {
  f: Refine;
  n: number;
  set: (k: keyof Refine, v: string) => void;
  reset: () => void;
  close: () => void;
}) {
  const box = useRef<HTMLElement>(null);
  useModalKeys(true, box, close);
  /* the panel opens with the keyboard on its close button */
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(".dh button")?.focus();
  }, []);
  const opt = (k: keyof Refine, v: string, label: string) => (
    <button
      key={v}
      type="button"
      className={f[k] === v ? "opt on" : "opt"}
      onClick={() => {
        set(k, v);
      }}
    >
      {label}
    </button>
  );
  return (
    <>
      <div className="dscrim" onClick={close}></div>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Refine maps" ref={box}>
        <div className="dh">
          <b>Refine</b>
          <button type="button" aria-label="Close" onClick={close}>
            &times;
          </button>
        </div>
        {FILTER_KEYS.map((k) => {
          const g = FILTERS[k];
          return (
            <div className="fg" key={k}>
              <span className="eyebrow">{g.label}</span>
              <div className="opts">
                {opt(k, "any", g.any)}
                {Object.entries(g.opts).map(([v, [label]]) => opt(k, v, label))}
              </div>
            </div>
          );
        })}
        <div className="fg">
          <span className="eyebrow">Sort</span>
          <div className="opts">
            {(Object.keys(SORTS) as Array<SortKey>).map((k) => opt("sort", k, SORTS[k].label))}
          </div>
        </div>
        <div className="dfoot">
          <button type="button" className="linkbtn" onClick={reset}>
            Clear all
          </button>
          <button type="button" className="go" onClick={close}>
            Show {plural(n, "map", "maps")}
          </button>
        </div>
      </aside>
    </>
  );
}

export function AllMaps({
  maps,
  view,
  asOf,
}: {
  maps: ReadonlyArray<MapCard>;
  view: string | null;
  asOf: number;
}) {
  const now = useClock(asOf);
  const [f, setF] = useState(() => refineFor(view));
  const [shown, setShown] = useState(MAPS_CHUNK);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  /* Next keeps a page it navigated away from and shows it again on the way back; as on
     the single-page site, coming back to a view starts it over from its preset */
  useEffect(
    () => () => {
      setF(refineFor(view));
      setShown(MAPS_CHUNK);
      setOpen(false);
    },
    [view],
  );
  const list = filteredMaps(maps, f, now),
    n = activeFilters(f).length;
  const stat = (m: MapCard) => SORTS[f.sort].stat(m, now);
  return (
    <>
      <BackLink href={homeHref()} label="Workshop" />
      <div className="ws-head">
        <h1 className="ws-h1">All maps</h1>
        <span className="ws-count">{plural(maps.length, "map", "maps")} with a time</span>
      </div>
      <div className="views">
        {VIEWS.map(([k, label, p]) => (
          <Link
            key={k}
            href={mapsHref(k)}
            className={sameRefine(f, { ...NO_FILTER(), ...p }) ? "on" : ""}
          >
            {label}
          </Link>
        ))}
        <span className="sp"></span>
        <button
          type="button"
          className={n ? "refine on" : "refine"}
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          Refine{n ? <> &middot; {n}</> : ""}
        </button>
      </div>
      <p className="ws-note">
        {plural(list.length, "map", "maps")} &middot; {SORTS[f.sort].label.toLowerCase()} first
      </p>
      {list.length ? (
        <>
          <MapGrid maps={list.slice(0, shown)} stat={stat} />
          {list.length > shown && (
            <button
              type="button"
              className="more-btn"
              onClick={() => {
                setShown((s) => s + MAPS_CHUNK);
              }}
            >
              Show more maps
            </button>
          )}
        </>
      ) : (
        <div className="empty">
          <b>No map fits all of these filters.</b>
        </div>
      )}
      {open && (
        <Drawer
          f={f}
          n={list.length}
          set={(k, v) => {
            setF((x) => ({ ...x, [k]: v }));
            setShown(MAPS_CHUNK);
          }}
          reset={() => {
            setF(NO_FILTER());
            setShown(MAPS_CHUNK);
          }}
          close={close}
        />
      )}
    </>
  );
}
