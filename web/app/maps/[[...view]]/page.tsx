// /maps[/<view>]: All maps, in one of its ready-made views or a shelf's See all
// (components/workshop/AllMaps). Every view is prerendered; anything else is a 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Remember } from "../../../components/BackLink";
import { Shell } from "../../../components/Shell";
import { AllMaps } from "../../../components/workshop/AllMaps";
import { getMapCards, getSite } from "../../../db/data";
import { mapsHref } from "../../../lib/routes";
import { PRESETS } from "../../../lib/workshop";

/* spelled out rather than Next's generated PageProps, which only exists after a build */
interface Props {
  params: Promise<{ view?: Array<string> }>;
}

export function generateStaticParams() {
  return [{ view: [] }, ...Object.keys(PRESETS).map((v) => ({ view: [v] }))];
}

export const metadata: Metadata = {
  title: "All maps",
  description:
    "Every Ballest of Them All Workshop map with a time, by runs, plays, length, age or how close the racing is.",
};

async function Maps({ params }: Props) {
  const { view = [] } = await params;
  const v = view.length ? view[0] : null;
  if (view.length > 1 || (v !== null && !Object.hasOwn(PRESETS, v))) notFound();
  const [{ asOf }, maps] = await Promise.all([getSite(), getMapCards()]);
  return (
    <>
      <AllMaps key={v} maps={maps} view={v} asOf={asOf} />
      <Remember trail="maps" href={mapsHref(v)} />
    </>
  );
}

export default function Page({ params }: Props) {
  return (
    <Shell view="maps">
      <section className="ws" id="ws">
        <Suspense>
          <Maps params={params} />
        </Suspense>
      </section>
    </Shell>
  );
}
