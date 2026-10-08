"use client";
// On a phone the rail is a sheet: the button across the top names the board on screen, and
// opens the season's boards from the bottom of the screen.
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useDialog } from "../Behaviours";
import { useMounted } from "../../hooks/client";

/* the sheet opens on the board on screen */
const current = (d: HTMLDialogElement) =>
  d.querySelector<HTMLElement>(".tstrip[aria-current='true']") ??
  d.querySelector<HTMLElement>(".tstrip");

export function BoardSheet({
  img,
  name,
  count,
  group,
  children,
}: {
  img: string | null;
  name: string;
  count: string;
  group: string;
  children: React.ReactNode;
}) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const closed = useCallback(() => {
    setOpen(false);
  }, []);
  const { props, close } = useDialog(open, closed, current);
  /* a desktop has the rail instead, so a sheet left open while the window widens closes */
  useEffect(() => {
    const wide = matchMedia("(min-width: 820px)");
    const shut = () => {
      if (wide.matches) close();
    };
    wide.addEventListener("change", shut);
    return () => {
      wide.removeEventListener("change", shut);
    };
  }, [close]);

  return (
    <>
      <button
        className="boardbtn"
        id="boardBtn"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        {img && <img className="bb-img" src={img} alt="" />}
        <span className="bb-name">{name}</span>
        <span className="bb-cnt">{count}</span>
        <span className="chev" aria-hidden="true">
          &#9662;
        </span>
      </button>
      {mounted &&
        createPortal(
          <dialog className="sheet" aria-label="Choose a leaderboard" {...props}>
            <span className="grab" aria-hidden="true"></span>
            <h2>{group}</h2>
            <div
              className="sheetlist"
              onClick={(e) => {
                if ((e.target as Element).closest("a")) close();
              }}
            >
              {children}
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
