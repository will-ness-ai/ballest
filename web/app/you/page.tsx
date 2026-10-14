// PROTOTYPE (grill-design, claude/prototype-standing): never merged. /you: where You stand on
// the Daily Report's four lists, the page its Discord button opens.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../components/Shell";
import { Standing } from "../../components/prototype/Standing";
import { getProtoLists } from "../../db/data";

export const metadata: Metadata = {
  title: "Where you stand",
  description: "Your place on the Daily Report's four lists.",
};

async function Lists() {
  return <Standing data={await getProtoLists()} />;
}

export default function Page() {
  return (
    <Shell view="players">
      <Suspense fallback={<div className="pt-wait">Counting the lists…</div>}>
        <Lists />
      </Suspense>
    </Shell>
  );
}
