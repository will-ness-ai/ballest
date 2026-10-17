// A Prefab's file read from the site, for the gallery's stills, the page's viewer and the Edit
// dialog's angle picker (lib/routes.ts prefabFileHref). Rejects when the read fails.
import type { PrefabFile } from "../../lib/prefab";

export const fetchPrefabFile = (href: string): Promise<PrefabFile> =>
  fetch(href).then((r) =>
    r.ok ? (r.json() as Promise<PrefabFile>) : Promise.reject(new Error(String(r.status))),
  );
