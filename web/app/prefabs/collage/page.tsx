// /prefabs/collage?g=<generator>[&only=<control,control>]: one Generator drawn in every variation
// (lib/generators variationsOf), a row each, from three angles, for an agent to read in one
// screenshot (.claude/skills/prefab-generators). Not for players: proxy.ts answers 404 for it in
// production, and it is kept out of search results.
import type { Metadata } from "next";

import { GeneratorCollage } from "../../../components/prefabs/make/GeneratorCollage";

export const metadata: Metadata = { title: "Generator collage", robots: { index: false } };

export default function Page() {
  return <GeneratorCollage />;
}
