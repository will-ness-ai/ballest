// PROTOTYPE (grill-design, claude/prototype-prefabs): /prefabs, every Prefab.
import { Suspense } from "react";

import { Shell } from "../../components/Shell";
import { PrefabGallery } from "../../components/prefabs/PrefabGallery";
import { PREFABS, readPrefab } from "../../lib/prefabs-list";

async function Body() {
  const all = await Promise.all(PREFABS.map(readPrefab));
  return <PrefabGallery prefabs={all} />;
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
