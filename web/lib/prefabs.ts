// The rules around Prefabs (CONTEXT.md) the pages and the API share: the fixed tags, the
// gallery's order, a Prefab's link, and who may do what. The file itself is lib/prefab.ts and
// the upload check lib/prefab-check.ts.

/* the tags an uploader picks from (T1), up to MAX_TAGS */
export const TAGS = ["Decoration", "Obstacle", "Ramp", "Loop", "Scenery", "Structure"] as const;
export const MAX_TAGS = 3;

export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 500;
/* uploads per player in any hour, deleted ones included (R1), unless the admin gave them
   their own limit (prefab_limits), up to MAX_HOURLY_UPLOADS */
export const HOURLY_UPLOADS = 5;
export const MAX_HOURLY_UPLOADS = 1000;
export const UPLOAD_WINDOW_MS = 3_600_000;

/* what GET /api/prefabs tells the upload form: who may upload, how many more they may now
   of their hourly limit, and, at none, when the next frees up */
export interface UploadQuota {
  signedIn: boolean;
  banned: boolean;
  left: number;
  limit: number;
  nextAt: string | null;
}
/* the quota of a reader who may not upload: signed out, or banned */
export const NO_UPLOADS: UploadQuota = {
  signedIn: false,
  banned: false,
  left: 0,
  limit: 0,
  nextAt: null,
};

/* a player's hourly upload limit, and whether the admin gave it them or it is the default */
export interface UploaderLimit {
  steamId: string;
  perHour: number;
  own: boolean;
}

/* the site's admin (B2): Will, who can take any Prefab down and ban an uploader */
export const ADMIN_STEAM_ID = "76561198047685844";

export interface PrefabFields {
  name: string;
  description: string;
  tags: Array<string>;
}

/* a Prefab's name, description and tags as typed, trimmed, or every reason they can't be */
export function checkFields(
  raw: PrefabFields,
): { ok: true; fields: PrefabFields } | { ok: false; problems: Array<string> } {
  const name = raw.name.trim();
  const description = raw.description.trim();
  const tags = [...new Set(raw.tags)];
  const problems: Array<string> = [];
  if (!name) problems.push("Give it a name.");
  else if (Array.from(name).length > NAME_MAX)
    problems.push(`Keep the name to ${String(NAME_MAX)} characters.`);
  if (Array.from(description).length > DESCRIPTION_MAX)
    problems.push(`Keep the description to ${String(DESCRIPTION_MAX)} characters.`);
  if (tags.length > MAX_TAGS) problems.push(`Pick up to ${String(MAX_TAGS)} tags.`);
  for (const t of tags)
    if (!(TAGS as ReadonlyArray<string>).includes(t))
      problems.push(`${t.slice(0, 40)} isn't one of the tags.`);
  return problems.length
    ? { ok: false, problems }
    : { ok: true, fields: { name, description, tags } };
}

export type GallerySort = "popular" | "newest";

interface Sortable {
  favorites: number;
  createdAt: string;
  tags: Array<string>;
}

/* the gallery as shown: Popular is most favorited first with the newest breaking a tie,
   Newest is by upload; a tag keeps only the Prefabs carrying it */
export function galleryOf<T extends Sortable>(
  cards: ReadonlyArray<T>,
  sort: GallerySort,
  tag: string | null,
): Array<T> {
  const newest = (a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
  return cards
    .filter((c) => !tag || c.tags.includes(tag))
    .sort((a, b) =>
      sort === "popular" ? b.favorites - a.favorites || newest(a, b) : newest(a, b),
    );
}

/* a Prefab's link from its first name: lower case, every other run of characters a dash */
export function slugOf(name: string) {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return stem || "prefab";
}
