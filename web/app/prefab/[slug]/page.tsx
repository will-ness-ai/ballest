// /prefab/<slug>: a Prefab's page (components/prefabs/PrefabPage). A slug nobody uploaded,
// or a Prefab deleted, taken down or hidden, says it's gone.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { PrefabGone, PrefabPage } from "../../../components/prefabs/PrefabPage";
import { pageMetadata } from "../../../components/metadata";
import { getPrefab } from "../../../db/data";
import { prefabHref } from "../../../lib/routes";

interface Props {
  params: Promise<{ slug: string }>;
}

/* Cache Components needs one param to build the route's shell; a slug that can't be one
   renders the gone page without reading the database */
export function generateStaticParams() {
  return [{ slug: "_" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getPrefab((await params).slug);
  if (!p) return { title: "Prefab not found", robots: { index: false } };
  return pageMetadata({
    title: p.name,
    description: `${p.name}, a Ballest of Them All editor prefab by ${p.uploader.name}: ${String(p.pieces)} pieces to view in 3D and download.`,
    canonical: prefabHref(p.slug),
  });
}

async function Body({ params }: Props) {
  const p = await getPrefab((await params).slug);
  return p ? <PrefabPage p={p} /> : <PrefabGone />;
}

export default function Page({ params }: Props) {
  return (
    <Shell view="prefab">
      <Suspense fallback={<div className="pf" />}>
        <Body params={params} />
      </Suspense>
    </Shell>
  );
}
