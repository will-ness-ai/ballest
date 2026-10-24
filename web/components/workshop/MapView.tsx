// A Map's page: the panel of its facts where a Circuit board has its rail (the picture,
// who made it, its Medals and how every run spreads out), and its board beside it, with
// no card. `focus` is a Steam ID whose row to find and mark.
import { notFound, redirect } from "next/navigation";

import { PartOf } from "./Campaign";
import { CreatorLink } from "./Card";
import { Age } from "./Age";
import { Map3D } from "./Map3D";
import { MedalList } from "./Medals";
import { DocTitle } from "../Behaviours";
import { PageHead } from "../PageHead";
import { Remember } from "../Trail";
import { BoardBody } from "../board/BoardBody";
import { HistoryCard } from "../board/HistoryCard";
import { MapImage } from "../MapImage";
import { ScorePlates } from "../board/BoardTop";
import {
  getBoardHistory,
  getBoardPage,
  getBoardPlaces,
  getBoardScores,
  getSite,
} from "../../db/data";
import { YouBanner } from "../board/YouBanner";
import { YouMarks } from "../board/YouMarks";
import { YouSpread } from "../board/YouSpread";
import type { WorkshopMap } from "../../lib/rows";
import { homeHref, mapHref } from "../../lib/routes";
import { BOARD_CHUNK, fmtN, fmtTime, isSteamId } from "../../lib/rules";
import { spreadOf } from "../../lib/spread";
import { HIDDEN, map3dOf, recordIfAny, reportHref, workshopHref } from "../../lib/workshop";

/* exported for its test (test/map-3d-button.test.tsx) */
export function MapPanel({
  m,
  scores,
  asOf,
}: {
  m: WorkshopMap;
  scores: Array<number>;
  asOf: number;
}) {
  const reason = HIDDEN[m.pfid];
  const view = map3dOf(m);
  const record = recordIfAny(m);
  return (
    <aside className="mpanel" id="mpanel">
      <MapImage preview={m.preview} className="mp-img" />
      {/* getting the Map into the game: its Workshop page, and what to do after subscribing */}
      <div className="mp-get">
        {view && <Map3D m={view} />}
        <a className="go mp-ws" href={workshopHref(m.pfid)} target="_blank" rel="noopener">
          Get it in Ballest ↗
        </a>
      </div>
      <p className="mp-how">
        Press <b>Subscribe</b> on Steam, then in Ballest go to the <b>Hub</b> and press{" "}
        <b>Downloads</b>.
      </p>
      <span className="mp-by">
        by <CreatorLink m={m} />
      </span>
      {reason && <p className="mp-flag">Reported broken: {reason}</p>}
      <PartOf pfid={m.pfid} />
      <dl className="mp-facts">
        <div>
          <dt>Runs</dt>
          <dd>{fmtN(m.entryCount)}</dd>
        </div>
        <div>
          <dt>Plays</dt>
          <dd>{fmtN(m.sessions)}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>
            <Age created={m.created} asOf={asOf} />
          </dd>
        </div>
        {record !== null && (
          <div>
            <dt>Record</dt>
            <dd>{fmtTime(record)}</dd>
          </div>
        )}
      </dl>
      {/* the record is in the facts above */}
      <MedalList className="mp-medals" record={null} medals={m.medals} />
      <div className="mp-chart">
        <span className="eyebrow">Every run</span>
        <div id="spread">
          <YouSpread name={m.name} chart={spreadOf(scores, m.medals, false)} />
        </div>
      </div>
      {!reason && (
        <a className="mp-report" href={reportHref(m)} target="_blank" rel="noopener">
          Report a broken map
        </a>
      )}
    </aside>
  );
}

/* `m` is the Map, or undefined for one the Workshop no longer lists (or never did): as the
   single-page site did, a stale link lands on the homepage. A Map nobody has a time on yet,
   new since the last Refresh (spec #259), has its page with an empty board. */
export async function MapView({ m, focus }: { m: WorkshopMap | undefined; focus: string | null }) {
  if (focus && !isSteamId(focus)) notFound();
  if (!m) redirect(homeHref());
  const name = m.name;
  const [site, page, scores, places, history] = await Promise.all([
    getSite(),
    getBoardPage(name, 0, BOARD_CHUNK + 3),
    getBoardScores(name),
    focus ? getBoardPlaces(name, [focus]) : Promise.resolve(null),
    getBoardHistory(name),
  ]);
  const rows = page.rows;
  const at = focus ? places?.[focus] : undefined;
  return (
    <>
      <PageHead
        path={mapHref(m.pfid)}
        title={m.title}
        trail="maps"
        page={{ board: name, maker: m.cid }}
      />
      <div className="main">
        <DocTitle title={m.title} />
        <MapPanel m={m} scores={scores} asOf={site.asOf} />
        <section className="content">
          <YouMarks name={name} />
          <YouBanner name={name} field={page.total} medals={m.medals} />
          <BoardBody
            order="score"
            name={name}
            points={false}
            where={"by " + m.creator}
            count={page.total}
            history={history && <HistoryCard h={history} />}
            leaders={<ScorePlates name={name} rows={rows} focus={focus} />}
            initial={page.total >= 3 ? rows.slice(3) : rows}
            lead={rows[0]?.score ?? null}
            pods={null}
            focus={focus && at ? { id: focus, rank: at.rank } : null}
          />
        </section>
        <Remember trail="board" href={mapHref(m.pfid)} label={m.title} />
      </div>
    </>
  );
}
