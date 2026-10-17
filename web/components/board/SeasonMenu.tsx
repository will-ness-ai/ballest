"use client";
// The season chip: a button and the popover menu it opens. The browser closes it on
// a tap outside or Escape; a pick closes it here, since the page it opens keeps this one.
// A Campaign's switch uses it too, as `kind` "Campaign", on a desktop as well as a phone.
import type { ReactNode } from "react";

export function SeasonMenu({
  id,
  label,
  kind = "Season",
  children,
}: {
  id: string;
  label: string;
  kind?: string;
  children: ReactNode;
}) {
  return (
    <>
      <button className="seasonchip" popoverTarget={id} aria-label={`${kind}: ${label}`}>
        {label} <span aria-hidden="true">&#9662;</span>
      </button>
      <nav
        className="seasonmenu"
        id={id}
        popover="auto"
        aria-label={kind}
        onClick={(e) => {
          if ((e.target as Element).closest("a")) e.currentTarget.hidePopover();
        }}
      >
        {children}
      </nav>
    </>
  );
}
