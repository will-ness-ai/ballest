// GET /og/<player|map|track|daily|campaign|prefab>/<id>: the share image a page names as its
// og:image (docs/site.md, "Share images"). Read through the same cached reads as the
// pages, so a card for a page someone just opened costs no database read; drawn on the
// first request and then kept by Vercel's CDN. 404 for an id that names nothing, so no
// crawler keeps junk.
import { drawShare, type SharePicture } from "../../../../components/share/Card";
import { fullAvatar, remote, trackShot } from "../../../../components/share/pictures";
import { prefabShot } from "../../../../components/share/prefab";
import {
  getBoardPage,
  getBoardScores,
  getCampaignShare,
  getDaily,
  getPlayer,
  getMap,
  getPrefab,
  getPrefabFile,
} from "../../../../db/data";
import { CAMPAIGN_MAX_PICTURES } from "../../../../lib/campaigns";
import { circuitBoard } from "../../../../lib/circuit";
import { isDailyDate } from "../../../../lib/routes";
import { isSteamId } from "../../../../lib/rules";
import {
  campaignCard,
  dailyCard,
  isShareKind,
  mapCard,
  playerCard,
  prefabCard,
  trackCard,
  type BoardTop,
  type ShareCard,
  type ShareKind,
} from "../../../../lib/share";

async function topOf(board: string): Promise<BoardTop> {
  const [page, scores] = await Promise.all([getBoardPage(board, 0, 1), getBoardScores(board)]);
  return { total: page.total, first: page.rows[0] ?? null, scores };
}

async function shareOf(
  kind: ShareKind,
  id: string,
): Promise<{ card: ShareCard; picture: SharePicture } | null> {
  switch (kind) {
    case "player": {
      const rec = isSteamId(id) ? await getPlayer(id) : null;
      if (!rec) return null;
      return { card: playerCard(rec), picture: await remote(fullAvatar(rec.who.avatar)) };
    }
    case "map": {
      const m = await getMap(id);
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
    case "campaign": {
      /* null for a slug that isn't curated, or none of whose Maps the Workshop lists: the
         page's own 404 */
      const s = await getCampaignShare(id);
      if (!s) return null;
      const band = await Promise.all(
        s.data.maps.slice(0, CAMPAIGN_MAX_PICTURES).map((m) => remote(m.preview)),
      );
      return { card: campaignCard(s.data.c, s.standing), picture: band };
    }
    case "prefab": {
      /* a Prefab that isn't live is gone from its page, so it has no card either */
      const p = await getPrefab(id);
      const f = p?.state === "live" ? await getPrefabFile(id) : null;
      if (!p || !f) return null;
      return { card: prefabCard(p), picture: await prefabShot(f.file, p.angle) };
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
