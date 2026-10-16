// The rules around Prefabs (CONTEXT.md) the pages and the API share: the fixed tags, the
// gallery's order, a Prefab's link, and who may do what. The file itself is lib/prefab.ts and
// the upload check lib/prefab-check.ts.

/* the tags an uploader picks from (T1), up to MAX_TAGS */
export const TAGS = ["Decoration", "Obstacle", "Ramp", "Loop", "Scenery", "Structure"] as const;
export const MAX_TAGS = 3;

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
