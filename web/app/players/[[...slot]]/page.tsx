// /players[/<scope>/<sort>]: every player ranked by one count, on the Circuit, the
// Workshop or both (components/players/PlayersTable). Every scope and sort is prerendered.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { PlayersTable } from "../../../components/players/PlayersTable";
import { getStandings } from "../../../db/data";
import { plValid } from "../../../lib/players";
import { PL_SCOPES, PL_SORTS, playersHref, type PlScope, type PlSort } from "../../../lib/routes";

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

const isScope = (s: string): s is PlScope => (PL_SCOPES as ReadonlyArray<string>).includes(s);
const isSort = (s: string): s is PlSort => (PL_SORTS as ReadonlyArray<string>).includes(s);

async function Table({ params }: Pick<Props, "params">) {
  const { slot = [] } = await params;
  const [scope = "all", sort = "wr"] = slot;
  if (slot.length > 2 || !isScope(scope) || !isSort(sort)) notFound();
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

/* the table's rows as grey bars, as the single-page site showed while standings.json loaded */
function Skeleton() {
  return Array.from({ length: 8 }, (_, i) => (
    <div className="skel" key={i}>
      <span></span>
      <span></span>
      <span></span>
    </div>
  ));
}

export default function Page({ params }: Props) {
  return (
    <Shell view="players">
      <section className="pls" id="pls">
        <Suspense fallback={<Skeleton />}>
          <Table params={params} />
        </Suspense>
      </section>
    </Shell>
  );
}
