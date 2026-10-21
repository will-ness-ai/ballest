// The Prefabs page's two tabs (grill-design round 2, C): the Prefabs players shared, and the
// Generators that make your own.
import Link from "next/link";

import { makePrefabHref, prefabsHref } from "../../../lib/routes";

export function PrefabTabs({ on }: { on: "shared" | "make" }) {
  return (
    <nav className="gen-tabs" aria-label="Prefabs">
      <Link href={prefabsHref()} aria-current={on === "shared" ? "page" : undefined}>
        Shared by players
      </Link>
      <Link href={makePrefabHref()} aria-current={on === "make" ? "page" : undefined}>
        Make your own
      </Link>
    </nav>
  );
}
