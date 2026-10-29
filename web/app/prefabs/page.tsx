// /prefabs: every live Prefab (components/prefabs/PrefabGallery).
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHead } from "../../components/PageHead";
import { Shell } from "../../components/Shell";
import { PrefabGallery } from "../../components/prefabs/PrefabGallery";
import { pageMetadata } from "../../components/metadata";
import { getPrefabCards } from "../../db/data";
import { prefabsHref } from "../../lib/routes";

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: "Prefabs",
    description:
      "Ready-made pieces for the Ballest of Them All level editor, made by players: view each in 3D and download it.",
    canonical: prefabsHref(),
  });
}

async function Body() {
  return <PrefabGallery cards={await getPrefabCards()} />;
}

export default function Page() {
  return (
    <Shell view="prefabs">
      <PageHead path={prefabsHref()} title="Prefabs" />
      <Suspense fallback={<div className="pfl" />}>
        <Body />
      </Suspense>
    </Shell>
  );
}
