// The pieces every Workshop view shares: a line of a Map's top three, its creator as a link,
// and the card the shelves, All maps and the search lay out. No state, so the server and
// the client views both draw them.
import Link from "next/link";

import { MapImage } from "../MapImage";
import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { mapHref } from "../../lib/routes";
import { fmtTime, personaOf } from "../../lib/rules";
import { recordOf, type MapCard } from "../../lib/workshop";
import { CAMPAIGNS } from "../../lib/campaigns";

/* one place of a Map's top three: [steam ID, persona, time] */
export function PodLine({ p, i }: { p: [string, string, number]; i: number }) {
  const r = { steamId: p[0], persona: p[1] };
  return (
    <span className="p3" data-m={i + 1}>
      <b>{i + 1}</b>
      <Marble who={r} />
      <span className="p3n">{personaOf(r)}</span>
      <span className="p3t">{fmtTime(p[2])}</span>
    </span>
  );
}

/* a Map's creator leads to the Maps they made */
export const CreatorLink = ({ m }: { m: { cid: string | null; creator: string } }) => (
  <PlayerLink id={m.cid} text={m.creator} tab="made" />
);

/* PROTOTYPE (round 4): the five badge looks a Map in a Campaign can carry on its picture;
   the picker shows one */
function CampaignBadges({ c, pfid }: { c: { title: string; maps: Array<string> }; pfid: string }) {
  const n = c.maps.indexOf(pfid) + 1,
    of = c.maps.length;
  return (
    <>
      <span className="cb-tag bv-A">
        <b>{c.title}</b> {n}/{of}
      </span>
      <span className="cb-strip bv-B">
        <span>{c.title}</span>
        <span>
          {n} / {of}
        </span>
      </span>
      <span className="cb-chip bv-D" title={c.title}>
        {n}/{of}
      </span>
      <span className="cb-dots bv-E">
        <span className="cb-dn">{c.title}</span>
        <span className="cb-dd">
          {c.maps.map((x, i) => (
            <i key={x} className={i + 1 === n ? "on" : undefined}></i>
          ))}
        </span>
      </span>
    </>
  );
}

/* `stat` is the figure the order in use is about */
export function MapCardLink({ m, stat }: { m: MapCard; stat: string }) {
  const r = { steamId: m.top3[0][0], persona: m.top3[0][1] };
  /* PROTOTYPE (round 3, variant C): a Map in a Campaign carries its badge */
  const c = CAMPAIGNS.find((x) => x.maps.includes(m.pfid));
  return (
    <Link className="mcard" href={mapHref(m.pfid)}>
      <span className="im">
        <MapImage preview={m.preview} />
        {c && <CampaignBadges c={c} pfid={m.pfid} />}
        <span className="pod3">
          {m.top3.map((p, i) => (
            <PodLine key={i} p={p} i={i} />
          ))}
        </span>
      </span>
      <span className="t">{m.title}</span>
      {c && (
        <span className="cline bv-C">
          <i aria-hidden="true"></i>
          {c.title} · map {c.maps.indexOf(m.pfid) + 1} of {c.maps.length}
        </span>
      )}
      <span className="s">
        <span>
          by {m.creator}
          {c && <span className="bv-D"> · {c.title}</span>}
        </span>
        <span className="num">{stat}</span>
      </span>
      <span className="lead">
        <Marble who={r} />
        <span>{personaOf(r)}</span>
        <span className="num">{fmtTime(recordOf(m))}</span>
      </span>
    </Link>
  );
}

export function MapGrid({
  maps,
  stat,
}: {
  maps: ReadonlyArray<MapCard>;
  stat: (m: MapCard) => string;
}) {
  return (
    <div className="mgrid">
      {maps.map((m) => (
        <MapCardLink key={m.pfid} m={m} stat={stat(m)} />
      ))}
    </div>
  );
}
