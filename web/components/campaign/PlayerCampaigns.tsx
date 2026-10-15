// PROTOTYPE (grill-design round 5: a player's Campaigns on their page). Never merged. Every
// variant is drawn; the picker's data-v on <html> shows one.
import Link from "next/link";

import { CampaignPics } from "./CampaignPics";
import { Shelf } from "../player/WorkshopTab";
import { Season } from "../player/PlayerView";
import type { getPlayerCampaigns } from "../../db/data";
import { campaignHref } from "../../lib/campaigns";
import { fmtN, ord } from "../../lib/rules";

export type PlayerCamps = Awaited<ReturnType<typeof getPlayerCampaigns>>;

/* A and B: each Campaign as a Circuit season, a tile per Map */
export function CampaignSeasons({
  camps,
  id,
  cls,
}: {
  camps: PlayerCamps;
  id: string;
  cls: string;
}) {
  return (
    <div className={cls}>
      {camps.map((k) => (
        <Season key={k.slug} s={k.season} id={id} />
      ))}
    </div>
  );
}

/* C: a card per Campaign */
export function CampaignCardsRow({ camps }: { camps: PlayerCamps }) {
  return (
    <div className="qv-C pcamps pws">
      <Shelf title="Campaigns">
        {camps.map((k) => {
          const o = k.season.overall;
          return (
            <Link
              key={k.slug}
              className="pcamp"
              href={campaignHref(k.slug)}
              data-m={o.rank <= 3 ? o.rank : 0}
            >
              <span className="pc-pic">
                <CampaignPics previews={k.previews} max={4} />
                <span className="pc-t">{k.c.title}</span>
              </span>
              <span className="pc-r">
                <b>{ord(o.rank)}</b>
                <small> of {fmtN(k.players)}</small>
              </span>
              <span className="pc-s">
                {fmtN(o.score)} pts · {k.finished}/{k.c.maps.length} maps
              </span>
              <span className="pc-bar">
                <i style={{ width: ((k.finished / k.c.maps.length) * 100).toFixed(0) + "%" }}></i>
              </span>
            </Link>
          );
        })}
      </Shelf>
    </div>
  );
}

/* D: a line under their name */
export function CampaignLine({ camps }: { camps: PlayerCamps }) {
  if (!camps.length) return null;
  return (
    <span className="pline qv-D">
      {camps.map((k, i) => (
        <span key={k.slug}>
          {i ? " · " : ""}
          <b>{ord(k.season.overall.rank)}</b> in{" "}
          <Link href={campaignHref(k.slug)}>{k.c.title}</Link>
        </span>
      ))}
    </span>
  );
}

/* E: a table, a row per Campaign with their place on each Map */
export function CampaignTable({ camps }: { camps: PlayerCamps }) {
  return (
    <section className="shelf qv-E">
      <div className="shelf-h">
        <h2>Campaigns</h2>
      </div>
      <div className="pctab">
        {camps.map((k) => {
          const o = k.season.overall;
          return (
            <Link key={k.slug} className="pctr" href={campaignHref(k.slug)}>
              <span className="pct-n">
                <b>{k.c.title}</b>
                <small>
                  {ord(o.rank)} of {fmtN(k.players)} · {fmtN(o.score)} pts
                </small>
              </span>
              <span className="pct-maps">
                {k.season.tiers[0].tracks.map((t) => (
                  <i
                    key={t.name}
                    title={t.display}
                    data-m={t.finish && t.finish.rank <= 3 ? t.finish.rank : undefined}
                    className={t.finish ? "on" : undefined}
                  >
                    {t.finish ? t.finish.rank : "–"}
                  </i>
                ))}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
