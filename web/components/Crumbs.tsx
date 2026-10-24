"use client";
// A page's breadcrumb (PageHead): crumbsOf (lib/nav.ts) over the page's path, its parent the
// page this tab remembers the reader came from where the page names a trail and that page
// leads to it (Trail.tsx), else `back`, the parent the server knows, else the Section's own.
// The page's own title ends it. Drawn only when there is a crumb before the title.
import Link from "next/link";

import { useTrail, type Trail, type TrailPage } from "./Trail";
import { crumbsOf, type Crumb, type NavFacts } from "../lib/nav";

export function Crumbs({
  path,
  title,
  facts,
  trail = null,
  page,
  back = null,
}: {
  path: string;
  title: string;
  facts: NavFacts;
  trail?: Trail | null;
  /* the board this page is and who made it, which a remembered player is checked against */
  page?: TrailPage;
  back?: Crumb | null;
}) {
  const remembered = useTrail(trail, path, page);
  const list = crumbsOf(path, facts, title, remembered ?? back);
  if (!list.length) return null;
  return (
    <nav className="ph-crumbs" aria-label="Breadcrumb">
      <ol>
        {list.map((c) => (
          <li key={c.href + c.label}>
            <Link href={c.href}>{c.label}</Link>
          </li>
        ))}
        <li aria-current="page">{title}</li>
      </ol>
    </nav>
  );
}
