// The pictures a card is drawn with, as data: URLs, which is how Satori takes them: Steam's
// and the site's own, fetched, and the files in assets/share/ (docs/site.md, "Share images").
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { TRACKS, boardPicture } from "../../lib/circuit";
import { SITE_ORIGIN } from "../../lib/routes";
import { safeImg } from "../../lib/rules";
import { SHARE_ASSETS } from "./Card";

/* the largest picture a card takes; a Workshop preview is well under it */
const MAX_PICTURE = 4 * 1024 * 1024;

/* a picture fetched for a card: its data: URL, or null and whether that was only for now
   (`temporary`: the fetch timed out, hit the network's failure, a 5xx, 408 or 429, so it may
   load next time) rather than for good (no address safeImg takes, a 4xx, not a picture, too
   large) */
export interface Fetched {
  src: string | null;
  temporary: boolean;
}

/* a picture from Steam's CDN, or one of the site's own files as production serves it, as a
   data: URL; a slow, failed or oversized fetch draws the fallback */
export async function fetchPicture(url: string | null | undefined): Promise<Fetched> {
  const safe = safeImg(url);
  if (!safe) return { src: null, temporary: false };
  const u = safe.startsWith("/") ? SITE_ORIGIN + safe : safe;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(3000) });
    const type = r.headers.get("content-type") ?? "";
    const size = Number(r.headers.get("content-length") ?? 0);
    if (!r.ok || !/^image\/(png|jpeg|gif)/.test(type) || size > MAX_PICTURE) {
      await r.body?.cancel();
      return { src: null, temporary: r.status >= 500 || r.status === 408 || r.status === 429 };
    }
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length > MAX_PICTURE) return { src: null, temporary: false };
    return { src: `data:${type};base64,${body.toString("base64")}`, temporary: false };
  } catch {
    return { src: null, temporary: true };
  }
}

/* fetchPicture's data: URL alone, for a card kept whatever its pictures did */
export const remote = async (url: string | null | undefined) => (await fetchPicture(url)).src;

/* Steam names an avatar's sizes by suffix; a card draws it larger than the medium one */
export const fullAvatar = (u: string | null | undefined) =>
  u?.replace(/_medium\.jpg$/, "_full.jpg");

/* one of assets/share/'s copies, or null for one that isn't there */
async function local(path: string, type: string) {
  try {
    return `data:${type};base64,` + (await readFile(join(SHARE_ASSETS, path))).toString("base64");
  } catch {
    return null;
  }
}

/* a Track's screenshot: the JPEG copy of circuit/<name>.webp, since Satori reads no WebP */
export const trackShot = (board: string) => local(join("circuit", board + ".jpg"), "image/jpeg");

/* a Track's or a Trial's picture: a Track's screenshot copy, a Trial's own picture (a JPEG,
   Leth Trial #1's) as the site serves it, or null for a Trial with none yet */
export const boardShot = (board: string) =>
  board in TRACKS ? trackShot(board) : remote(boardPicture(board));

/* a Skin's picture: the PNG copy of skins/<asset>.webp, for the same reason */
export const skinShot = (asset: string) => local(join("skins", asset + ".png"), "image/png");
