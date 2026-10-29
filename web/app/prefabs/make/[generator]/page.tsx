// /prefabs/make/<generator>: one Generator's page (components/prefabs/make/GeneratorEditor).
// proxy.ts answers 404 for a key that isn't one, so every path here is a Generator.
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHead } from "../../../../components/PageHead";
import { Shell } from "../../../../components/Shell";
import { GeneratorEditor } from "../../../../components/prefabs/make/GeneratorEditor";
import { FONTS_HREF } from "../../../../components/prefabs/make/lettering";
import { pageMetadata } from "../../../../components/metadata";
import { generatorOf } from "../../../../lib/generators";
import { GENERATOR_KEYS, generatorHref } from "../../../../lib/routes";

interface Props {
  params: Promise<{ generator: string }>;
}

export function generateStaticParams() {
  return GENERATOR_KEYS.map((generator) => ({ generator }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const g = generatorOf((await params).generator);
  if (!g) return { title: "Not found", robots: { index: false } };
  return pageMetadata({
    title: `Make a ${g.name.toLowerCase()} prefab`,
    description: `${g.blurb} Change it to suit your map and download it as a Ballest of Them All prefab.`,
    canonical: generatorHref(g.key),
  });
}

async function Body({ params }: Props) {
  const { generator } = await params;
  const g = generatorOf(generator);
  return (
    <>
      {g && <PageHead path={generatorHref(g.key)} title={g.name} />}
      {g?.lettered && (
        // only a Generator that letters draws in these, so only its page loads them
        <link rel="stylesheet" precedence="default" href={FONTS_HREF} />
      )}
      <GeneratorEditor generator={generator} />
    </>
  );
}

export default function Page({ params }: Props) {
  return (
    <Shell view="prefabs">
      <Suspense fallback={<div className="gen" />}>
        <Body params={params} />
      </Suspense>
    </Shell>
  );
}
