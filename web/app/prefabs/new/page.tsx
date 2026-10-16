// PROTOTYPE (grill-design, claude/prototype-prefabs): /prefabs/new, uploading a Prefab.
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { UploadPrototype } from "../../../components/prefabs/UploadPrototype";

export default function Page() {
  return (
    <Shell view="maps">
      <Suspense fallback={<div className="pfu" />}>
        <UploadPrototype />
      </Suspense>
    </Shell>
  );
}
