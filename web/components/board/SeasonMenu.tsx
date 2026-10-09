"use client";
// The phone's season chip: a button and the popover menu it opens. The browser closes it on
// a tap outside or Escape; a pick closes it here, since the page it opens keeps this one.
import type { ReactNode } from "react";

export function SeasonMenu({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <button className="seasonchip" popoverTarget={id} aria-label={`Season: ${label}`}>
        {label} <span aria-hidden="true">&#9662;</span>
      </button>
      <nav
        className="seasonmenu"
        id={id}
        popover="auto"
        aria-label="Season"
        onClick={(e) => {
          if ((e.target as Element).closest("a")) e.currentTarget.hidePopover();
        }}
      >
        {children}
      </nav>
    </>
  );
}
