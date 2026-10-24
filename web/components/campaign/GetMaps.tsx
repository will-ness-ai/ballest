"use client";
// Get the Maps (spec #359): on every page of a Campaign's frame, a button floating at the
// bottom left that opens a checklist of its Workshop Maps. Steam has no link that subscribes
// for you, so each row links the Map's Workshop page, and ticks once opened, in this browser
// only; a Campaign with a Steam collection also gets its Subscribe to all, the one way Steam
// subscribes to several Maps at once. Under the list, what to do in the game.
import { useRef, useState, useSyncExternalStore } from "react";

import { useDialog } from "../Modal";
import type { GetMapRow } from "../../lib/campaigns";
import { workshopHref } from "../../lib/workshop";

/* the Maps opened from the checklist, per Campaign, in localStorage: a convenience, so the
   page works the same without it */
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
function useOpened(slug: string): [Set<string>, (opened: Set<string>) => void] {
  const key = "getmaps-" + slug;
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
  const save = (opened: Set<string>) => {
    try {
      localStorage.setItem(key, [...opened].join(","));
    } catch {
      // storage blocked: the ticks last until the page is left
    }
    listeners.forEach((l) => {
      l();
    });
  };
  return [new Set(raw ? raw.split(",") : []), save];
}

export function GetMaps({
  slug,
  title,
  collection,
  rows,
}: {
  slug: string;
  title: string;
  collection: string | null;
  rows: ReadonlyArray<GetMapRow>;
}) {
  const [open, setOpen] = useState(false);
  const from = useRef<HTMLButtonElement>(null);
  const { props, close } = useDialog({ open, onClose: () => setOpen(false), from });
  const [opened, save] = useOpened(slug);
  if (!rows.length) return null;
  const n = rows.length;
  const done = rows.filter((r) => opened.has(r.pfid)).length;
  const tick = (pfid: string) => {
    save(new Set(opened).add(pfid));
  };
  return (
    <>
      <button ref={from} type="button" className="go getmaps-open" onClick={() => setOpen(true)}>
        {n === 1 ? "Get the Map" : `Get the ${n} Maps`}
      </button>
      <dialog className="ptsx getmaps" aria-labelledby="getmapsHead" {...props}>
        <div className="dh">
          <h2 id="getmapsHead">Play {title} in Ballest</h2>
          <button type="button" aria-label="Close" onClick={close}>
            &times;
          </button>
        </div>
        {collection ? (
          <div className="gm-all">
            <a className="go" href={workshopHref(collection)} target="_blank" rel="noopener">
              Subscribe to all {n} at once ↗
            </a>
            <p>Its Steam collection subscribes to every Map in one press. Or one at a time:</p>
          </div>
        ) : (
          <p className="gm-lead">
            Subscribe to each Map in the Steam Workshop, then open the Hub in Ballest and press
            Downloads.
          </p>
        )}
        <div className="gm-prog">
          <span>
            {done} of {n} opened
          </span>
          <span className="gm-bar" aria-hidden>
            <i style={{ inlineSize: `${(100 * done) / n}%` }} />
          </span>
          {done > 0 && (
            <button type="button" className="linkbtn" onClick={() => save(new Set())}>
              Start over
            </button>
          )}
        </div>
        <ul className="gm-list">
          {rows.map((r) => {
            const seen = opened.has(r.pfid);
            return (
              <li key={r.pfid} data-opened={seen ? "" : undefined}>
                {r.pic ? <img src={r.pic} alt="" loading="lazy" /> : <span className="gm-nopic" />}
                <span className="gm-lab">
                  <b>{r.no}</b>
                  <span>{r.name ?? `Map ${r.no}`}</span>
                </span>
                <a
                  href={workshopHref(r.pfid)}
                  target="_blank"
                  rel="noopener"
                  onClick={() => tick(r.pfid)}
                >
                  {seen ? "✓ Opened" : "Subscribe ↗"}
                </a>
              </li>
            );
          })}
        </ul>
        <h3 className="eyebrow">Then in Ballest</h3>
        <ol className="gm-steps">
          <li>
            <span>3</span>
            <b>Go to the Hub</b>
          </li>
          <li>
            <span>4</span>
            <b>Press the Downloads button</b>
          </li>
        </ol>
      </dialog>
    </>
  );
}
