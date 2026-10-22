// The pictures a card is drawn with, as data: URLs, which is how Satori takes them: Steam's
// and the site's own, fetched, and the files in assets/share/ (docs/site.md, "Share images").
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { SITE_ORIGIN } from "../../lib/routes";
import { safeImg } from "../../lib/rules";
import { SHARE_ASSETS } from "./Card";

/* the largest picture a card takes; a Workshop preview is well under it */
const MAX_PICTURE = 4 * 1024 * 1024;

/* a picture from Steam's CDN, or one of the site's own files as production serves it, as a
   data: URL; a slow, failed or oversized fetch draws the fallback */
export async function remote(url: string | null | undefined) {
  const safe = safeImg(url);
  if (!safe) return null;
  const u = safe.startsWith("/") ? SITE_ORIGIN + safe : safe;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(3000) });
    const type = r.headers.get("content-type") ?? "";
    const size = Number(r.headers.get("content-length") ?? 0);
    if (!r.ok || !/^image\/(png|jpeg|gif)/.test(type) || size > MAX_PICTURE) return null;
    const body = Buffer.from(await r.arrayBuffer());
    return body.length > MAX_PICTURE ? null : `data:${type};base64,${body.toString("base64")}`;
  } catch {
    return null;
  }
}

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

/* a Skin's picture: the PNG copy of skins/<asset>.webp, for the same reason */
export const skinShot = (asset: string) => local(join("skins", asset + ".png"), "image/png");
