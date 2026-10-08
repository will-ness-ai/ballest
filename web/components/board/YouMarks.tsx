"use client";
// Your row in a board's list, and your plate if you're in the top 3, picked out by your
// Steam ID: every row and plate carries its player's in `data-id`. A style rule rather
// than a prop, so it reaches rows the server drew and rows the list adds later by
// scrolling or search alike, without threading You through the server's components.
// The rule reaches only into this element's parent (the page's content), so a page Next
// keeps hidden after you navigate away leaves the others alone. That is `:has()` on this
// style element rather than a bare `@scope`: Chromium 141 keeps a bare `@scope` rule's
// styles after its element is removed, which left a previous You highlighted.
import { useId } from "react";

import { useYouOnBoard } from "../../hooks/you";
import { isSteamId } from "../../lib/rules";

export function YouMarks({ name }: { name: string }) {
  const you = useYouOnBoard(name);
  const key = useId();
  if (you.kind !== "played") return null;
  const id = you.who.steamId;
  /* the ID goes into a selector, so only the shape a Steam ID can have */
  if (!isSteamId(id)) return null;
  const scope = `:has(> style[data-you-marks="${key}"])`;
  const row = `${scope} .row[data-id="${id}"]`,
    plate = `${scope} .plate[data-id="${id}"]`;
  return (
    <style data-you-marks={key}>{`
${row} {
  background: var(--accent-soft);
  box-shadow: inset 3px 0 0 var(--accent);
}
${plate} .pl-name {
  color: var(--accent);
}
${row} .nm a::after,
${plate} .pl-name a::after {
  content: " · you";
  color: var(--accent);
  font-weight: 600;
}`}</style>
  );
}
