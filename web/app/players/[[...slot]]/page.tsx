// /players[/<scope>/<sort>]: every player ranked by one count, on the Circuit, the
// Workshop or both (components/players/PlayersTable). Every scope and sort is prerendered.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { PlayersSkeleton } from "../../../components/Skeleton";
import { PlayersTable } from "../../../components/players/PlayersTable";
import { getStandings } from "../../../db/data";
import { plValid } from "../../../lib/players";
import { PL_SCOPES, PL_SORTS, isPlScope, isPlSort, playersHref } from "../../../lib/routes";

interface Props {
  params: Promise<{ slot?: Array<string> }>;
}

export function generateStaticParams() {
  return [
    { slot: [] },
    ...PL_SCOPES.flatMap((scope) =>
      PL_SORTS.filter((sort) => plValid(scope, sort)).map((sort) => ({ slot: [scope, sort] })),
    ),
  ];
}

export const metadata: Metadata = {
  title: "Players",
  description:
    "Every Ballest of Them All player ranked by world records, podiums, top 5s or Maps finished, on the Circuit, the Workshop or both.",
};

async function Table({ params }: Pick<Props, "params">) {
  const { slot = [] } = await params;
  const [scope = "all", sort = "wr"] = slot;
  if (slot.length > 2 || !isPlScope(scope) || !isPlSort(sort)) notFound();
  /* the Circuit has no Maps column, and a scope alone means its world records */
  if (!plValid(scope, sort) || slot.length === 1)
    redirect(playersHref(scope, plValid(scope, sort) ? sort : "wr"));
  return (
    <PlayersTable
      key={scope + "/" + sort}
      standings={await getStandings()}
      scope={scope}
      sort={sort}
    />
  );
}

export default function Page({ params }: Props) {
  return (
    <Shell view="players">
      <section className="pls" id="pls">
        <Suspense fallback={<PlayersSkeleton />}>
          <Table params={params} />
        </Suspense>
      </section>
    </Shell>
  );
}
