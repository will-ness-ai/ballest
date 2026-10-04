"use client";
// On a phone the rail is a sheet: the button across the top names the board on screen, and
// opens the season's boards from the bottom of the screen.
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useModalKeys } from "../Behaviours";
import { useMounted } from "../../hooks/client";

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
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    /* the scroller in this layout is the root element, not body, so both were locked */
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    trigger.current?.focus(); /* hand focus back to the trigger */
  }, []);
  useModalKeys(open, sheet, close);

  return (
    <>
      <button
        className="boardbtn"
        id="boardBtn"
        aria-haspopup="dialog"
        ref={trigger}
        onClick={() => {
          setOpen(true);
          document.documentElement.style.overflow = "hidden";
          document.body.style.overflow = "hidden";
          const list = sheet.current;
          (
            list?.querySelector<HTMLElement>(".tstrip[aria-current='true']") ??
            list?.querySelector<HTMLElement>(".tstrip")
          )?.focus();
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
          <>
            <div className={open ? "scrim open" : "scrim"} onClick={close} />
            <div
              className={open ? "sheet open" : "sheet"}
              ref={sheet}
              role="dialog"
              aria-modal="true"
              aria-label="Choose a leaderboard"
            >
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
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
