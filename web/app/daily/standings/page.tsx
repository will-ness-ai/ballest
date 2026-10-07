// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
// /daily/standings: round 6's variants over the frozen Daily fixture.
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { DailyStandingsPrototype } from "../../../components/prototype/DailyStandings";

export default function Page() {
  return (
    <Shell view="maps">
      <Suspense fallback={null}>
        <DailyStandingsPrototype />
      </Suspense>
    </Shell>
  );
}
