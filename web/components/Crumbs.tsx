"use client";
// A page's breadcrumb (PageHead): the trail the server worked out, or, where the page names a
// trail and this tab remembers where the reader came from (Trail.tsx), that page as the
// parent. The page's own title ends it. Drawn only when there is a crumb before the title.
import Link from "next/link";

import { useTrail, type Trail } from "./Trail";
import { crumbsOf, type Crumb, type NavFacts } from "../lib/nav";

export function Crumbs({
  path,
  title,
  crumbs,
  trail,
}: {
  path: string;
  title: string;
  /* the trail with nothing remembered */
  crumbs: Array<Crumb>;
  /* the trail whose page is the parent, and what crumbsOf needs to name it */
  trail?: { name: Trail; facts: NavFacts };
}) {
  const back = useTrail(trail?.name ?? null, path);
  const list = back && trail ? crumbsOf(path, trail.facts, title, back) : crumbs;
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
