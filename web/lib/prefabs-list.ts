// PROTOTYPE (grill-design, claude/prototype-prefabs): the hard-coded Prefabs, read from the
// root prefabs/ folder at build time.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PrefabFile } from "./prefab";

export interface PrefabEntry {
  slug: string;
  name: string;
  creator: string;
  steamId?: string;
  description: string;
  added: string;
  file: string;
}

export const PREFABS: Array<PrefabEntry> = [
  {
    slug: "bench",
    name: "Bench",
    creator: "Will",
    description: "A park bench of dark pipes and planks, to dress the edge of a run.",
    added: "2026-10-15",
    file: "samples/bench.json",
  },
  {
    slug: "testparkhill",
    name: "Park hill",
    creator: "Will",
    description: "A grassy hill of white boulders with a concrete scoop, three lime pads on top.",
    added: "2026-10-15",
    file: "samples/testparkhill.json",
  },
];

export async function readPrefab(entry: PrefabEntry): Promise<{ file: PrefabFile; bytes: number }> {
  "use cache";
  const text = await readFile(join(process.cwd(), "..", "prefabs", entry.file), "utf8");
  return { file: JSON.parse(text) as PrefabFile, bytes: Buffer.byteLength(text) };
}
