// A Map's page: the panel of its facts where a Circuit board has its rail (the picture,
// who made it, its Medals and how every run spreads out), and its board beside it, with
// no tiles or card. `focus` is a Steam ID whose row to find and mark.
import { notFound, redirect } from "next/navigation";

import { CreatorLink } from "./Card";
import { Age } from "./Age";
import { BackLink, Remember } from "../BackLink";
import { DocTitle } from "../Behaviours";
import { BoardBody } from "../board/BoardBody";
import { MapImage } from "../MapImage";
import { ScorePlates } from "../board/BoardTop";
import { YouSlot, YouSpread } from "../proto/You";
import { getBoardPage, getBoardPlaces, getBoardScores, getSite } from "../../db/data";
import type { WorkshopMap } from "../../lib/rows";
import { homeHref, mapHref } from "../../lib/routes";
import { BOARD_CHUNK, MEDALS, fmtN, fmtSec, fmtTime, isSteamId } from "../../lib/rules";
import { HIDDEN, reportHref } from "../../lib/workshop";

function MapPanel({ m, scores, asOf }: { m: WorkshopMap; scores: Array<number>; asOf: number }) {
  const reason = HIDDEN[m.pfid];
  return (
    <aside className="mpanel" id="mpanel">
      <BackLink trail="maps" />
      <MapImage preview={m.preview} className="mp-img" />
      <div>
        <h1 className="mp-t">{m.title}</h1>
        <span className="mp-by">
          by <CreatorLink m={m} />
        </span>
      </div>
      {reason && <p className="mp-flag">Reported broken: {reason}</p>}
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
        <div>
          <dt>Record</dt>
          <dd>{fmtTime(m.top3[0][2])}</dd>
        </div>
      </dl>
      <div className="mp-medals">
        {MEDALS.map(([name, c, i]) => (
          <div key={name}>
            <span>
              <i style={{ background: c }}></i>
              {name}
            </span>
            <b>{fmtSec(m.medals[i])}</b>
          </div>
        ))}
      </div>
      <YouSlot
        place="panel"
        name={m.name}
        total={m.entryCount}
        lead={m.top3[0][2]}
        medals={m.medals}
      />
      <div className="mp-chart">
        <span className="eyebrow">Every run</span>
        <div id="spread">
          <YouSpread name={m.name} ts={scores} medals={m.medals} wide={false} />
        </div>
      </div>
      <a
        className="go mp-ws"
        href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${m.pfid}`}
        target="_blank"
        rel="noopener"
      >
        Open in Steam Workshop
      </a>
      {!reason && (
        <a className="mp-report" href={reportHref(m)} target="_blank" rel="noopener">
          Report a broken map
        </a>
      )}
    </aside>
  );
}

/* `m` is the Map, or undefined for one the Workshop no longer lists (or never did, or
   nobody has a time on): as the single-page site did, a stale link lands on the homepage */
export async function MapView({ m, focus }: { m: WorkshopMap | undefined; focus: string | null }) {
  if (focus && !isSteamId(focus)) notFound();
  if (!m?.top3.length) redirect(homeHref());
  const name = m.name;
  const [site, page, scores, places] = await Promise.all([
    getSite(),
    getBoardPage(name, 0, BOARD_CHUNK + 3),
    getBoardScores(name),
    focus ? getBoardPlaces(name, [focus]) : Promise.resolve(null),
  ]);
  const rows = page.rows;
  const at = focus ? places?.[focus] : undefined;
  const you = { name, total: page.total, lead: rows[0]?.score ?? null, medals: m.medals };
  return (
    <div className="main">
      <DocTitle title={m.title} />
      <MapPanel m={m} scores={scores} asOf={site.asOf} />
      <section className="content">
        <YouSlot place="top" {...you} />
        <YouSlot place="head" {...you} />
        <BoardBody
          order="score"
          name={name}
          points={false}
          where={"by " + m.creator}
          count={page.total}
          leaders={
            <ScorePlates
              name={name}
              rows={rows}
              focus={focus}
              extra={<YouSlot place="plates" {...you} />}
            />
          }
          initial={page.total >= 3 ? rows.slice(3) : rows}
          lead={rows[0]?.score ?? null}
          pods={null}
          focus={focus && at ? { id: focus, rank: at.rank } : null}
        />
      </section>
      <Remember trail="board" href={mapHref(m.pfid)} label={m.title} />
    </div>
  );
}
