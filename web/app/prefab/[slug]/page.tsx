// PROTOTYPE (grill-design, claude/prototype-prefabs): /prefab/<slug>, one Prefab's page.
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { Prototype } from "../../../components/prefabs/Prototype";
import { footprintOf, partsOf, shapesOf } from "../../../lib/prefab";
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
  const { file, bytes } = await readPrefab(entry);
  const facts = {
    slug: entry.slug,
    name: entry.name,
    creator: entry.creator,
    description: entry.description,
    added: entry.added,
    href: "/prefabs/" + entry.file,
    filename: entry.file.split("/").at(-1) ?? entry.file,
    bytes,
    pieces: file.items.length,
    parts: partsOf(file),
    size: footprintOf(shapesOf(file)),
  };
  return <Prototype file={file} facts={facts} />;
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
