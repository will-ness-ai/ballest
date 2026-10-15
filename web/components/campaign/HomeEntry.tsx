// PROTOTYPE (grill-design round 3: how the Workshop homepage leads to Campaigns). Never
// merged. Every variant is drawn; the picker's data-v on <html> shows one.
import Link from "next/link";

import { MapImage } from "../MapImage";
import { Marble } from "../Marble";
import { getBoardPage, getCampaignData } from "../../db/data";
import { CAMPAIGNS, campaignBoard, campaignHref, type Campaign } from "../../lib/campaigns";
import { fmtN, personaOf } from "../../lib/rules";
import type { BoardRow } from "../../lib/rows";

export interface CampaignCard {
  c: Campaign;
  previews: Array<string | null>;
  players: number;
  leader: BoardRow | null;
}

export async function campaignCards(): Promise<Array<CampaignCard>> {
  return Promise.all(
    CAMPAIGNS.map(async (c) => {
      const [data, page] = await Promise.all([
        getCampaignData(c.slug),
        getBoardPage(campaignBoard(c), 0, 1),
      ]);
      return {
        c,
        previews: (data?.maps ?? []).map((m) => m.preview),
        players: page.total,
        leader: page.rows[0] ?? null,
      };
    }),
  );
}

function Leader({ k }: { k: CampaignCard }) {
  if (!k.leader) return null;
  return (
    <span className="lead">
      <Marble who={k.leader} still />
      <span>{personaOf(k.leader)}</span>
      <span className="num">{fmtN(k.leader.score)} pts</span>
    </span>
  );
}

/* A: a shelf of Campaign cards, a 2x2 of its Maps' pictures */
export function CampaignShelf({ cards }: { cards: Array<CampaignCard> }) {
  return (
    <section className="shelf hv-A">
      <div className="shelf-h">
        <h2>Campaigns</h2>
        <span className="shelf-n">Player-made sets, ranked like the Circuit</span>
      </div>
      <div className="strip">
        {cards.map((k) => (
          <Link key={k.c.slug} className="mcard ccard" href={campaignHref(k.c.slug)}>
            <span className="im quad">
              {k.previews.slice(0, 4).map((p, i) => (
                <MapImage key={i} preview={p} />
              ))}
            </span>
            <span className="t">{k.c.title}</span>
            <span className="s">
              <span>by {k.c.creator}</span>
              <span className="num">{k.c.maps.length} maps</span>
            </span>
            <Leader k={k} />
          </Link>
        ))}
      </div>
    </section>
  );
}

/* B: a band of wide banners, each a Campaign's pictures in a row behind its name */
export function CampaignBand({ cards }: { cards: Array<CampaignCard> }) {
  return (
    <section className="shelf hv-B">
      <div className="shelf-h">
        <h2>Campaigns</h2>
        <span className="shelf-n">{cards.length} curated sets</span>
      </div>
      <div className="cband">
        {cards.map((k) => (
          <Link key={k.c.slug} className="cban" href={campaignHref(k.c.slug)}>
            <span className="cban-pics">
              {k.previews.slice(0, 5).map((p, i) => (
                <MapImage key={i} preview={p} />
              ))}
            </span>
            <span className="cban-in">
              <span className="eyebrow">
                Campaign · {k.c.maps.length} maps · {fmtN(k.players)} players
              </span>
              <b>{k.c.title}</b>
              <span className="cban-by">by {k.c.creator}</span>
              {k.leader && (
                <span className="cban-lead">
                  <Marble who={k.leader} still /> {personaOf(k.leader)} leads with{" "}
                  {fmtN(k.leader.score)}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* D: a Campaigns menu in the head, beside All maps */
export function CampaignMenu({ cards }: { cards: Array<CampaignCard> }) {
  return (
    <span className="hv-D cmenu-w">
      <button className="alllink cmenu-b" popoverTarget="cmenu">
        Campaigns &#9662;
      </button>
      <nav className="seasonmenu cmenu" id="cmenu" popover="auto" aria-label="Campaigns">
        {cards.map((k) => (
          <Link key={k.c.slug} href={campaignHref(k.c.slug)}>
            <b>{k.c.title}</b>
            <small>
              {k.c.maps.length} Maps · {fmtN(k.players)} players · by {k.c.creator}
            </small>
          </Link>
        ))}
      </nav>
    </span>
  );
}

/* E: a compact table above the carousel */
export function CampaignTable({ cards }: { cards: Array<CampaignCard> }) {
  return (
    <section className="shelf hv-E">
      <div className="shelf-h">
        <h2>Campaigns</h2>
        <span className="shelf-n">Ranked like the Circuit</span>
      </div>
      <div className="ctable">
        {cards.map((k) => (
          <Link key={k.c.slug} href={campaignHref(k.c.slug)} className="ctrow">
            <span className="ctpic">
              <MapImage preview={k.previews[0]} />
            </span>
            <span className="ctname">
              <b>{k.c.title}</b>
              <small>by {k.c.creator}</small>
            </span>
            <span className="num ctn">{k.c.maps.length} maps</span>
            <span className="num ctn ctp">{fmtN(k.players)} players</span>
            <Leader k={k} />
          </Link>
        ))}
      </div>
    </section>
  );
}
