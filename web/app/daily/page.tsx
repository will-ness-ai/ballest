// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
// /daily: the round's variants over the frozen Daily fixture.
import { Suspense } from "react";

import { Shell } from "../../components/Shell";
import { DailyPrototype } from "../../components/prototype/DailyPrototype";
import { getWorkshop } from "../../db/data";

async function Previews() {
  const maps = await getWorkshop();
  return <DailyPrototype previews={Object.fromEntries(maps.map((m) => [m.pfid, m.preview]))} />;
}

export default function Page() {
  return (
    <Shell view="maps">
      <Suspense fallback={null}>
        <Previews />
      </Suspense>
    </Shell>
  );
}
