// /you: Where you stand, You's place on the four Workshop standings (components/you/YouView),
// reached from the Players tab and the Daily Report's "Where do I stand?" button.
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHead } from "../../components/PageHead";
import { Shell } from "../../components/Shell";
import { YouSkeleton } from "../../components/Skeleton";
import { Remember } from "../../components/Trail";
import { YouView } from "../../components/you/YouView";
import { youHref } from "../../lib/routes";

export const metadata: Metadata = {
  title: "Where you stand",
  description:
    "Your place on the Daily Report's four Workshop lists: Maps played, Author Medals, world records and top 5s.",
  alternates: { canonical: youHref() },
};

export default function Page() {
  return (
    <Shell view="you">
      <PageHead path={youHref()} title="Where you stand" />
      <Remember trail="board" href={youHref()} label="Where you stand" />
      <Suspense fallback={<YouSkeleton />}>
        <YouView />
      </Suspense>
    </Shell>
  );
}
