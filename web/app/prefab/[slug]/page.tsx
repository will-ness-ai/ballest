// PROTOTYPE (grill-design, claude/prototype-prefabs): /prefab/<slug>, one Prefab's page.
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { PrefabPage } from "../../../components/prefabs/PrefabPage";
import { PREFABS, readPrefab } from "../../../lib/prefabs-list";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return PREFABS.map((p) => ({ slug: p.slug }));
}

async function Body({ params }: Props) {
  const { slug } = await params;
  const entry = PREFABS.find((p) => p.slug === slug);
  if (!entry) notFound();
  const { file, facts } = await readPrefab(entry);
  return <PrefabPage file={file} facts={facts} />;
}

export default function Page({ params }: Props) {
  return (
    <Shell view="map">
      <Suspense fallback={<div className="pf" />}>
        <Body params={params} />
      </Suspense>
    </Shell>
  );
}
