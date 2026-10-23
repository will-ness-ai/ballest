// /prefabs/guide: the Prefabs page's How to tab (components/prefabs/PrefabGuide).
import type { Metadata } from "next";

import { Shell } from "../../../components/Shell";
import { PrefabGuide } from "../../../components/prefabs/PrefabGuide";
import { pageMetadata } from "../../../components/metadata";
import { prefabGuideHref } from "../../../lib/routes";

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: "How to save and spawn prefabs",
    description:
      "Save pieces of your Ballest of Them All map as a prefab, spawn one into another map, and share it with other players.",
    canonical: prefabGuideHref(),
  });
}

export default function Page() {
  return (
    <Shell view="prefabs">
      <PrefabGuide />
    </Shell>
  );
}
