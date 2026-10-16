// PROTOTYPE (grill-design, claude/prototype-prefabs): /prefabs, every Prefab.
import { Suspense } from "react";

import { Shell } from "../../components/Shell";
import { ListPrototype } from "../../components/prefabs/ListPrototype";
import { PREFABS, readPrefab } from "../../lib/prefabs-list";

async function Body() {
  const all = await Promise.all(PREFABS.map(readPrefab));
  return <ListPrototype prefabs={all} />;
}

export default function Page() {
  return (
    <Shell view="maps">
      <Suspense fallback={<div className="pfl" />}>
        <Body />
      </Suspense>
    </Shell>
  );
}
