// PROTOTYPE: /prefabs/make, the Prefab generators (components/prototype/Generators). Never merged.
import type { Metadata } from "next";

import { Shell } from "../../../components/Shell";
import { Generators } from "../../../components/prototype/Generators";

export const metadata: Metadata = {
  title: "Make a prefab",
  robots: { index: false },
};

export default function Page() {
  return (
    <Shell view="prefabs">
      <Generators />
    </Shell>
  );
}
