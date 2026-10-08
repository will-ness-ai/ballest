// /daily/standings: the all-time Daily standings (components/daily/StandingsView), over
// final Dailies only. A static segment, so it wins over /daily's [[...slot]].
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { DailySkeleton } from "../../../components/Skeleton";
import { StandingsView } from "../../../components/daily/StandingsView";

export const metadata: Metadata = {
  title: "Daily standings",
  description:
    "The game's Daily, all time: the most wins, podiums and Dailies played, the longest runs, and every player's medals.",
};

export default function Page() {
  return (
    <Shell view="daily">
      <Suspense fallback={<DailySkeleton />}>
        <StandingsView />
      </Suspense>
    </Shell>
  );
}
