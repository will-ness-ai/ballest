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
      {/* the sign's extra fonts (PROTOTYPE) */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        precedence="default"
        href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Caveat:wght@700&family=Lobster&family=Press+Start+2P&family=Rubik+Mono+One&display=swap"
      />
      <Generators />
    </Shell>
  );
}
