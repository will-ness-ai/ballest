"use client";
// How points work: opened from any "?" on an Overall board. Season 1 has two Overall
// boards, so there it also says which one this is.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useModalKeys } from "../Behaviours";
import { S1_CURRENT_BOARD, S1_FINAL_BOARD } from "../../lib/circuit";
import { useMounted } from "../../lib/client";
import { fmtN, ord, trackPoints } from "../../lib/rules";

export function PointsDialog({ board, tracks }: { board: string; tracks: number }) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const from = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    if (from.current?.isConnected) from.current.focus();
  }, []);
  useModalKeys(open, box, close);
  useEffect(() => {
    const open = (e: MouseEvent) => {
      const q = (e.target as Element | null)?.closest<HTMLElement>("[data-ptsx]");
      if (!q) return;
      from.current = q;
      setOpen(true);
      requestAnimationFrame(() => box.current?.querySelector("button")?.focus());
    };
    document.addEventListener("click", open);
    return () => {
      document.removeEventListener("click", open);
    };
  }, []);

  if (!mounted) return null;
  return createPortal(
    <>
      <div className="dscrim" hidden={!open} onClick={close} />
      <div
        className="ptsx"
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ptsxHead"
        hidden={!open}
      >
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
      </div>
    </>,
    document.body,
  );
}
