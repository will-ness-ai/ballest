// The Prefabs page's tabs (grill-design round 2, C): the Prefabs players shared, the
// Generators that generate your own, and How to, the guide to saving, spawning and sharing one.
import Link from "next/link";

import { makePrefabHref, prefabGuideHref, prefabsHref } from "../../lib/routes";

const TABS = [
  { on: "shared", href: prefabsHref(), label: "Shared by players" },
  { on: "make", href: makePrefabHref(), label: "Generate your own" },
  { on: "guide", href: prefabGuideHref(), label: "How to" },
] as const;

export function PrefabTabs({ on }: { on: (typeof TABS)[number]["on"] }) {
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
