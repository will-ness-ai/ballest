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
    /* sideways only: a scrollIntoView would also move the page, undoing an entry page's
       scroll to its row */
    const show = () => {
      const b = bar.current;
      const tab = b?.querySelector('[aria-selected="true"]');
      if (!b || !tab) return;
      const cs = getComputedStyle(b);
      const t = tab.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      const left = r.left + (parseFloat(cs.scrollPaddingInlineStart) || 0);
      const right = r.right - (parseFloat(cs.scrollPaddingInlineEnd) || 0);
      if (t.left < left) b.scrollLeft -= left - t.left;
      else if (t.right > right) b.scrollLeft += t.right - right;
    };
    show();
    /* the web fonts widen the tabs when they arrive, which can push the lit one back out */
    void document.fonts.ready.then(show);
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
