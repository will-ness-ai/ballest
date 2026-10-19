"use client";
// "Refreshed ... ago" in the header, and the dialog it opens on how the boards refresh.
// The time is worked out in the browser, so a page cached hours ago still says how old
// the boards are now, and a tab come back to after a while reads a newer Refresh in
// (useLatestRefresh).
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useDialog } from "./Modal";
import { useLatestRefresh, useMounted, useNow } from "../hooks/client";
import { relTime } from "../lib/rules";

export function Freshness({
  refreshedAt,
  mapsReadBy,
}: {
  refreshedAt: string | null;
  mapsReadBy: string | null;
}) {
  const now = useNow();
  useLatestRefresh(refreshedAt);
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { props, close } = useDialog({
    open,
    onClose: () => {
      setOpen(false);
    },
    from: trigger,
  });

  if (!refreshedAt)
    return (
      <p className="freshness">
        <button type="button" id="freshness" disabled>
          Data unavailable
        </button>
      </p>
    );
  const dt = new Date(refreshedAt);
  const ago = now == null ? null : relTime(dt, now);
  return (
    <p className="freshness">
      <button
        type="button"
        id="freshness"
        aria-haspopup="dialog"
        ref={trigger}
        disabled={ago == null}
        title={mounted ? dt.toLocaleString() : undefined}
        aria-label={ago == null ? undefined : `Refreshed ${ago}. How the boards refresh`}
        onClick={() => {
          setOpen(true);
        }}
      >
        {ago == null ? (
          "Loading"
        ) : (
          <>
            Refreshed <b>{ago}</b>
            <span className="i" aria-hidden="true">
              i
            </span>
          </>
        )}
      </button>
      {mounted &&
        createPortal(
          <dialog className="rfx" aria-labelledby="rfxHead" {...props}>
            <div className="dh">
              <h2 id="rfxHead">How the boards refresh</h2>
              <button type="button" aria-label="Close" onClick={close}>
                &times;
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <td></td>
                  <th scope="col">Circuit</th>
                  <th scope="col">Workshop</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">A first time on a board</th>
                  <td>next refresh</td>
                  <td>
                    usually a refresh or two later<small>at most a day or so</small>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Beating your own time</th>
                  <td>next refresh</td>
                  <td>
                    usually a refresh or two later<small>at most a day or so</small>
                  </td>
                </tr>
                <tr>
                  <th scope="row">A new map</th>
                  <td>&ndash;</td>
                  <td>
                    within minutes<small>its times come with the next refresh</small>
                  </td>
                </tr>
              </tbody>
            </table>
            <p>A refresh runs every three hours, on the hour.</p>
            <p>
              Workshop boards are only read when Steam shows the map was played, which it can take a
              few hours to notice, plus a full read of every map once a day.
            </p>
            <p>
              Today&apos;s Daily is read every refresh, and each Daily once more after it closes;
              from then on it is final.
            </p>
            {mapsReadBy && now != null && (
              <p>
                Every map was last read in full <b>{relTime(new Date(mapsReadBy), now)}</b>.
              </p>
            )}
          </dialog>,
          document.body,
        )}
    </p>
  );
}
