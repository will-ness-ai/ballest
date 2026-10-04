"use client";
// The tabs across the top: the Workshop (the homepage), each season, All Seasons, then
// Players. Which one is lit follows the path, so every page's frame can share them.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { circuitBoard } from "../lib/circuit";

export const WORKSHOP_GROUP = "Workshop";
export const PLAYERS_TAB = "Players";

export interface GroupTab {
  group: string;
  href: string;
}

/* the tab a path belongs to; a player's page and a head to head belong to none */
export function groupOfPath(path: string): string | null {
  if (path === "/" || /^\/maps?(\/|$)/.test(path)) return WORKSHOP_GROUP;
  if (/^\/players(\/|$)/.test(path)) return PLAYERS_TAB;
  const board = /^\/board\/([^/]+)/.exec(path);
  return board ? (circuitBoard(decodeURIComponent(board[1]))?.group ?? null) : null;
}

export function GroupTabs({ tabs }: { tabs: ReadonlyArray<GroupTab> }) {
  return <Tabs tabs={tabs} on={groupOfPath(usePathname())} />;
}

/* the same tabs with none lit, while the path is not known yet */
export function Tabs({ tabs, on }: { tabs: ReadonlyArray<GroupTab>; on: string | null }) {
  const bar = useRef<HTMLElement>(null);
  /* where the bar scrolls sideways, keep the selected tab in it */
  useEffect(() => {
    const el = bar.current,
      sel = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el && sel) el.scrollLeft = Math.max(0, sel.offsetLeft + sel.offsetWidth - el.clientWidth);
  }, [on]);
  return (
    <nav className="groups" id="groups" role="tablist" aria-label="Season" ref={bar}>
      {tabs.map((t) => (
        <Link
          key={t.group}
          className="gtab"
          role="tab"
          aria-selected={t.group === on}
          href={t.href}
        >
          {t.group}
        </Link>
      ))}
    </nav>
  );
}
