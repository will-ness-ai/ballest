// /prefabs/make: Make your own, a card per Generator (components/prefabs/make/MakeGallery).
import type { Metadata } from "next";

import { PageHead } from "../../../components/PageHead";
import { Shell } from "../../../components/Shell";
import { MakeGallery } from "../../../components/prefabs/make/MakeGallery";
import { pageMetadata } from "../../../components/metadata";
import { makePrefabHref } from "../../../lib/routes";

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: "Make a prefab",
    description:
      "Make a sign, a tree or a bush for the Ballest of Them All editor, and download it as a prefab.",
    canonical: makePrefabHref(),
  });
}

export default function Page() {
  return (
    <Shell view="prefabs">
      <PageHead path={makePrefabHref()} title="Make a prefab" />
      <MakeGallery />
    </Shell>
  );
}
