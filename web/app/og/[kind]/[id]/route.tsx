// GET /og/<player|map|track|daily>/<id>: the share image a page names as its og:image
// (docs/site.md, "Share images"). Read through the same cached reads as the pages, so a card
// for a page someone just opened costs no database read; drawn on the first request and
// then kept by Vercel's CDN. 404 for an id that names nothing, so no crawler keeps junk.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { SHARE_ASSETS, drawShare } from "../../../../components/share/Card";
import {
  getBoardPage,
  getBoardScores,
  getDaily,
  getPlayer,
  getWorkshop,
} from "../../../../db/data";
import { circuitBoard } from "../../../../lib/circuit";
import { isDailyDate } from "../../../../lib/routes";
import { isSteamId, safeImg } from "../../../../lib/rules";
import {
  dailyCard,
  isShareKind,
  mapCard,
  playerCard,
  trackCard,
  type BoardTop,
  type ShareCard,
  type ShareKind,
} from "../../../../lib/share";

/* the largest picture a card takes; a Workshop preview is well under it */
const MAX_PICTURE = 4 * 1024 * 1024;

/* a picture from Steam's CDN as a data: URL; a slow, failed or oversized fetch draws the
   fallback */
async function remote(url: string | null | undefined) {
  const u = safeImg(url);
  if (!u) return null;
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

/* a Track's screenshot: the JPEG copy of circuit/<name>.webp, since Satori reads no WebP */
async function trackShot(board: string) {
  try {
    const jpg = await readFile(join(SHARE_ASSETS, "circuit", board + ".jpg"));
    return "data:image/jpeg;base64," + jpg.toString("base64");
  } catch {
    return null;
  }
}

async function topOf(board: string): Promise<BoardTop> {
  const [page, scores] = await Promise.all([getBoardPage(board, 0, 1), getBoardScores(board)]);
  return { total: page.total, first: page.rows[0] ?? null, scores };
}

/* Steam names an avatar's sizes by suffix; the card draws it at 288 px */
const fullAvatar = (u: string | null | undefined) => u?.replace(/_medium\.jpg$/, "_full.jpg");

async function shareOf(
  kind: ShareKind,
  id: string,
): Promise<{ card: ShareCard; picture: string | null } | null> {
  switch (kind) {
    case "player": {
      const rec = isSteamId(id) ? await getPlayer(id) : null;
      if (!rec) return null;
      return { card: playerCard(rec), picture: await remote(fullAvatar(rec.who.avatar)) };
    }
    case "map": {
      const m = (await getWorkshop()).find((x) => x.pfid === id);
      if (!m) return null;
      return { card: mapCard(m, Date.now()), picture: await remote(m.preview) };
    }
    case "track": {
      const b = circuitBoard(id);
      const card = b ? trackCard(b, await topOf(b.name)) : null;
      if (!b || !card) return null;
      return { card, picture: await trackShot(b.name) };
    }
    case "daily": {
      const d = isDailyDate(id) ? await getDaily(id) : null;
      if (!d) return null;
      const [top, picture] = await Promise.all([topOf(d.board), remote(d.preview)]);
      return { card: dailyCard(d, top), picture };
    }
  }
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ kind: string; id: string }> },
) {
  const { kind, id } = await ctx.params;
  const share = isShareKind(kind) ? await shareOf(kind, id) : null;
  if (!share) return new Response("no such page", { status: 404 });
  return drawShare(share.card, share.picture);
}
