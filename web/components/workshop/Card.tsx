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

/* `stat` is the figure the order in use is about */
export function MapCardLink({ m, stat }: { m: MapCard; stat: string }) {
  const r = { steamId: m.top3[0][0], persona: m.top3[0][1] };
  return (
    <Link className="mcard" href={mapHref(m.pfid)}>
      <span className="im">
        <MapImage preview={m.preview} />
        <span className="pod3">
          {m.top3.map((p, i) => (
            <PodLine key={i} p={p} i={i} />
          ))}
        </span>
      </span>
      <span className="t">{m.title}</span>
      <span className="s">
        <span>by {m.creator}</span>
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
