// A Campaign's boards down the left on a desktop and in the sheet on a phone, as a season's
// are: Overall in words, then each Map as a strip of its preview picture with its number,
// record, short name and run count. A Map opens inside the Campaign's frame.
import Link from "next/link";

import { ProtoRailWs } from "../prototype/WsLinks";

import { campaignBoard, mapName, mapNo, type Campaign } from "../../lib/campaigns";
import { campaignHref } from "../../lib/routes";
import { fmtTime, plural, safeImg } from "../../lib/rules";
import type { WorkshopMap } from "../../lib/rows";

export function CampaignRailItems({
  c,
  maps,
  current,
  players,
}: {
  c: Campaign;
  maps: ReadonlyArray<WorkshopMap>;
  /* the board on screen: the Campaign's or one of its Maps' */
  current: string;
  players: number;
}) {
  return (
    <>
      <Link
        className="tstrip plain"
        href={campaignHref(c.slug)}
        aria-current={current === campaignBoard(c)}
      >
        <span className="lab">
          <b>Overall</b> <small>{plural(players, "player", "players")}</small>
        </span>
      </Link>
      {maps.map((m) => {
        const pic = safeImg(m.preview);
        const named = mapName(c, m.pfid, m.title);
        return (
          /* PROTOTYPE: the wrapper and the rail button */
          <div className="pws-wrap" key={m.pfid}>
            <Link
              className="tstrip"
              href={campaignHref(c.slug, m.pfid)}
              aria-current={current === m.name}
            >
              {pic && <img src={pic} alt="" loading="lazy" decoding="async" />}{" "}
              <span className="lab">
                <b>{mapNo(c, m.pfid)}</b>
                <span className="rt">{m.top3[0] ? fmtTime(m.top3[0][2]) : " "}</span>{" "}
                <small>
                  {named !== null && (
                    <>
                      <span className="mname">{named}</span> ·{" "}
                    </>
                  )}
                  {plural(m.entryCount, "run", "runs")}
                </small>
              </span>
            </Link>
            <ProtoRailWs pfid={m.pfid} />
          </div>
        );
      })}
    </>
  );
}
