"use client";
// Get the Maps (spec #359): on every page of a Campaign's frame, a button floating at the
// bottom left that opens a checklist of its Workshop Maps. Steam has no link that subscribes
// for you, so each row links the Map's Workshop page, and ticks once opened, in this browser
// only; a Campaign with a Steam collection also gets its Subscribe to all, the one way Steam
// subscribes to several Maps at once. The steps are numbered through: Subscribe above the
// list, what to do in the game under it.
import { useRef, useState, useSyncExternalStore } from "react";

import { useDialog } from "../Modal";
import type { Campaign, GetMapRow } from "../../lib/campaigns";
import { workshopHref } from "../../lib/workshop";

/* the Maps opened from the checklist, per Campaign, in localStorage: a convenience, so the
   page works the same without it. Another tab's ticks arrive by the storage event */
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    removeEventListener("storage", l);
  };
};
const read = (key: string) => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const idsOf = (raw: string) => new Set(raw ? raw.split(",") : []);
/* the opened Maps, and tick (more Maps, read afresh so another tab's stay) or clear them */
function useOpened(slug: string) {
  const key = "getmaps-" + slug;
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => "",
  );
  const write = (opened: Set<string>) => {
    try {
      localStorage.setItem(key, [...opened].join(","));
    } catch {
      // storage blocked: nothing ticks
    }
    listeners.forEach((l) => {
      l();
    });
  };
  return {
    opened: idsOf(raw),
    tick: (ids: ReadonlyArray<string>) => {
      write(new Set([...idsOf(read(key)), ...ids]));
    },
    clear: () => {
      write(new Set());
    },
  };
}

/* the steps, numbered through: Subscribe on Steam above the list, the game's under it */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li>
      <span>{n}</span>
      <b>{children}</b>
    </li>
  );
}

/* `rows` are getMapRows(c, the page's Maps): the server picks them, so the page sends this
   only what the checklist draws */
export function GetMaps({ c, rows }: { c: Campaign; rows: ReadonlyArray<GetMapRow> }) {
  const { slug, title } = c;
  const collection = c.collection ?? null;
  const [open, setOpen] = useState(false);
  const from = useRef<HTMLButtonElement>(null);
  const { props, close } = useDialog({ open, onClose: () => setOpen(false), from });
  const { opened, tick, clear } = useOpened(slug);
  if (!rows.length) return null;
  const n = rows.length;
  const done = rows.filter((r) => opened.has(r.pfid)).length;
  return (
    <>
      {/* data-float: qa's overlap probe leaves out what floats over the page by design */}
      <button
        ref={from}
        type="button"
        className="go getmaps-open"
        data-float=""
        onClick={() => setOpen(true)}
      >
        {n === 1 ? "Get the Map" : `Get the ${n} Maps`}
      </button>
      <dialog className="ptsx getmaps" aria-labelledby="getmapsHead" {...props}>
        <div className="dh">
          <h2 id="getmapsHead">Play {title} in Ballest</h2>
          <button type="button" aria-label="Close" onClick={close}>
            &times;
          </button>
        </div>
        <ol className="gm-steps">
          <Step n={1}>Open each Map in the Steam Workshop</Step>
          <Step n={2}>Press Subscribe</Step>
        </ol>
        {collection && (
          <div className="gm-all">
            <a
              className="go"
              href={workshopHref(collection)}
              target="_blank"
              rel="noopener"
              onClick={() => tick(rows.map((r) => r.pfid))}
            >
              Subscribe to all {n} at once ↗
            </a>
            <p>Its Steam collection subscribes to every Map in one press. Or one at a time:</p>
          </div>
        )}
        <div className="gm-prog">
          <span>
            {done} of {n} opened
          </span>
          <span className="gm-bar" aria-hidden>
            <i style={{ inlineSize: `${(100 * done) / n}%` }} />
          </span>
          {done > 0 && (
            <button type="button" className="linkbtn" onClick={clear}>
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
                  onClick={() => tick([r.pfid])}
                  /* a middle-click opens it in a tab too, with no click event */
                  onAuxClick={(e) => e.button === 1 && tick([r.pfid])}
                >
                  {seen ? "✓ Opened" : "Subscribe ↗"}
                </a>
              </li>
            );
          })}
        </ul>
        <h3 className="eyebrow">Then in Ballest</h3>
        <ol className="gm-steps" start={3}>
          <Step n={3}>Go to the Hub</Step>
          <Step n={4}>Press the Downloads button</Step>
        </ol>
      </dialog>
    </>
  );
}
