// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
import { Suspense } from "react";

import { DailyTabPrototype } from "./DailyTab";
import { getWorkshop } from "../../db/data";

async function WithPreviews({ id }: { id: string }) {
  const maps = await getWorkshop();
  return (
    <DailyTabPrototype
      id={id}
      previews={Object.fromEntries(maps.map((m) => [m.pfid, m.preview]))}
    />
  );
}

export function DailyTabServer({ id }: { id: string }) {
  return (
    <Suspense fallback={null}>
      <WithPreviews id={id} />
    </Suspense>
  );
}
