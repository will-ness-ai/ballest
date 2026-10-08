"use client";
// The tabs across the top: the Workshop (the homepage), each season, All Seasons, then
// Players. Which one is lit follows the path, so every page's frame can share them.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { groupOfPath } from "../lib/routes";

export interface GroupTab {
  group: string;
  href: string;
}

export function GroupTabs({ tabs }: { tabs: ReadonlyArray<GroupTab> }) {
  return <Tabs tabs={tabs} on={groupOfPath(usePathname())} />;
}

/* the same tabs with none lit, while the path is not known yet */
export function Tabs({ tabs, on }: { tabs: ReadonlyArray<GroupTab>; on: string | null }) {
  const bar = useRef<HTMLElement>(null);
  /* where the bar scrolls sideways, keep the selected tab in it, clear of the faded edge
     (the bar's scroll-padding) */
  useEffect(() => {
    bar.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
