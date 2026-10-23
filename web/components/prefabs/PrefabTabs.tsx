// The Prefabs page's heading and tabs (grill-design round 2, C): the Prefabs players shared,
// the Generators that generate your own, and How to, the guide to saving, spawning and sharing.
import Link from "next/link";
import type { ReactNode } from "react";

import { makePrefabHref, prefabGuideHref, prefabsHref } from "../../lib/routes";

const TABS = [
  { on: "shared", href: prefabsHref(), label: "Shared by players" },
  { on: "make", href: makePrefabHref(), label: "Generate your own" },
  { on: "guide", href: prefabGuideHref(), label: "How to" },
] as const;

type Tab = (typeof TABS)[number]["on"];

/* the heading every tab shares, its own line under it, an action beside it, then the tabs */
export function PrefabsHead({
  on,
  blurb,
  action,
}: {
  on: Tab;
  blurb: ReactNode;
  action?: ReactNode;
}) {
  return (
    <>
      <header className="pfl-head">
        <div>
          <h1>Prefabs</h1>
          <p>{blurb}</p>
        </div>
        {action}
      </header>
      <PrefabTabs on={on} />
    </>
  );
}

function PrefabTabs({ on }: { on: Tab }) {
  return (
    <nav className="gen-tabs" aria-label="Prefabs">
      {TABS.map((t) => (
        <Link key={t.on} href={t.href} aria-current={on === t.on ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
