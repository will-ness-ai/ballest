"use client";
// How points work: the dialog, and the "?" on an Overall board that opens it. Season 1 has
// two Overall boards, so there it also says which one this is.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useDialog } from "../Behaviours";
import { S1_CURRENT_BOARD, S1_FINAL_BOARD } from "../../lib/circuit";
import { useMounted } from "../../hooks/client";
import { fmtN, ord, trackPoints } from "../../lib/rules";

/* the "?" that opens how points work. On a desktop the Points column head carries it, so
   the card's copy shows only on a phone, or with `always` when the board is sorted by
   podiums and there is no Points column */
export function QMark({ always }: { always?: boolean }) {
  return (
    <button
      type="button"
      className={always ? "qmark always" : "qmark"}
      data-ptsx=""
      aria-label="How points work"
    >
      ?
    </button>
  );
}

export function PointsDialog({ board, tracks }: { board: string; tracks: number }) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const from = useRef<HTMLElement | null>(null);
  /* Safari doesn't focus a button it clicks, so the "?" takes focus back itself */
  const closed = useCallback(() => {
    setOpen(false);
    if (from.current?.isConnected) from.current.focus();
  }, []);
  const { props, close } = useDialog(open, closed);
  useEffect(() => {
    const open = (e: MouseEvent) => {
      const q = (e.target as Element | null)?.closest<HTMLElement>("[data-ptsx]");
      if (!q) return;
      from.current = q;
      setOpen(true);
    };
    document.addEventListener("click", open);
    return () => {
      document.removeEventListener("click", open);
    };
  }, []);

  if (!mounted) return null;
  return createPortal(
    <dialog className="ptsx" aria-labelledby="ptsxHead" {...props}>
      <div className="dh">
        <h2 id="ptsxHead">How points work</h2>
        <button type="button" aria-label="Close" onClick={close}>
          &times;
        </button>
      </div>
      <div>
        <p>
          Every track pays points for your place on it, and past 10th the payout halves at every
          10&times; in place. Your points are what all {fmtN(tracks)} tracks pay you, added up.
        </p>
        <table>
          <tbody>
            {[1, 2, 3, 10, 100, 1000, 10000].map((r) => (
              <tr key={r}>
                <th scope="row">{fmtN(r) + ord(r).replace(/^\d+/, "")}</th>
                <td>{fmtN(trackPoints(r))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {board === S1_CURRENT_BOARD ? (
          <p>
            These are worked out from today&apos;s places on the Season 1 tracks. Final has the
            standings when the season ended.
          </p>
        ) : board === S1_FINAL_BOARD ? (
          <p>
            These are the standings when Season 1 ended. Places have moved since; Current has them
            as they are now.
          </p>
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}
