// PROTOTYPE (grill-design, claude/prototype-prefabs): the hard-coded Prefabs, read from the
// root prefabs/ folder at build time.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { footprintOf, partsOf, shapesOf, type PrefabFile } from "./prefab";
import type { PrefabFacts } from "../components/prefabs/PrefabPage";

export interface PrefabEntry {
  slug: string;
  name: string;
  creator: string;
  description: string;
  added: string;
  file: string;
}

export const PREFABS: Array<PrefabEntry> = [
  {
    slug: "bench",
    name: "Bench",
    creator: "Will",
    description: "Placeholder: a park bench of dark pipes and planks, to dress the edge of a run.",
    added: "2026-10-15",
    file: "samples/bench.json",
  },
  {
    slug: "testparkhill",
    name: "Park hill",
    creator: "Will",
    description:
      "Placeholder: a hill of white boulders with a concrete scoop, three lime pads on top.",
    added: "2026-10-15",
    file: "samples/testparkhill.json",
  },
];

export async function readPrefab(
  entry: PrefabEntry,
): Promise<{ file: PrefabFile; facts: PrefabFacts }> {
  "use cache";
  const text = await readFile(join(process.cwd(), "..", "prefabs", entry.file), "utf8");
  const file = JSON.parse(text) as PrefabFile;
  return {
    file,
    facts: {
      slug: entry.slug,
      name: entry.name,
      creator: entry.creator,
      description: entry.description,
      added: entry.added,
      href: "/prefabs/" + entry.file,
      filename: entry.file.split("/").at(-1) ?? entry.file,
      bytes: Buffer.byteLength(text),
      pieces: file.items.length,
      parts: partsOf(file),
      size: footprintOf(shapesOf(file)),
    },
  };
}
