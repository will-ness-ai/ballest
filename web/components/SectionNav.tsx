"use client";
// The header's two rows of links: the Sections, with their icons, and the current
// Section's sub-tabs as pills. What each row holds and which link is lit is the navigation
// model's (lib/nav.ts), read from the path, so every page's frame can share them.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { navOf, type Nav, type NavFacts, type SectionKey } from "../lib/nav";

export function SectionNav({ facts }: { facts: NavFacts }) {
  return <SectionRows nav={navOf(usePathname(), facts)} />;
}

/* the Sections with none lit, while the path is not known yet: the sub-tabs' row keeps
   its height, so the page doesn't move when they arrive */
export function SectionRows({ nav }: { nav: Nav }) {
  const sections = useLitInView(nav.section);
  const subs = useLitInView(nav.subs.find((s) => s.on)?.href ?? null);
  return (
    <>
      <nav className="sections" aria-label="Sections" ref={sections}>
        {nav.sections.map((s) => (
          <Link key={s.key} href={s.href} aria-current={s.on ? "page" : undefined}>
            <SectionIcon k={s.key} />
            {s.label}
          </Link>
        ))}
      </nav>
      <nav className="subs" aria-label="In this Section" ref={subs}>
        {nav.subs.map((s) => (
          <Link key={s.href} href={s.href} aria-current={s.on ? "page" : undefined}>
            {s.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

/* where a row scrolls sideways, keep its lit link in it, clear of the faded edge (the
   row's scroll-padding). Sideways only: a scrollIntoView would also move the page, undoing
   an entry page's scroll to its row */
function useLitInView(on: string | null) {
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    const show = () => {
      const r = row.current;
      const lit = r?.querySelector('[aria-current="page"]');
      if (!r || !lit) return;
      const cs = getComputedStyle(r);
      const t = lit.getBoundingClientRect();
      const box = r.getBoundingClientRect();
      const left = box.left + (parseFloat(cs.scrollPaddingInlineStart) || 0);
      const right = box.right - (parseFloat(cs.scrollPaddingInlineEnd) || 0);
      if (t.left < left) r.scrollLeft -= left - t.left;
      else if (t.right > right) r.scrollLeft += t.right - right;
    };
    show();
    /* the web fonts widen the links when they arrive, which can push the lit one back out */
    void document.fonts.ready.then(show);
  }, [on]);
  return row;
}

/* each Section's mark, drawn in the text colour; the site search marks its hits with them */
const ICONS: Record<SectionKey, string> = {
  maps: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  campaigns: "M5 21V4M5 4h11l-2 4 2 4H5",
  daily: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  circuit:
    "M8 4h8v4a4 4 0 0 1-8 0zM6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3M12 12v4M8 20h8l-1-4H9z",
  players:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a5.5 5.5 0 0 1 3.5 6",
  prefabs: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
};
export function SectionIcon({ k }: { k: SectionKey }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[k]} />
    </svg>
  );
}
