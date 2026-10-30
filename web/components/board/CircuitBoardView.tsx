// A Circuit board's page: the season switch, the season's boards in the rail (a sheet on a
// phone, beside the switch's chip), the card
// across the top, the history card and plates, and the list. `slot` is what follows the board's
// name in its path: a Steam ID whose row to find and mark, or on an Overall board
// "podiums" for its podium order. A Trial's board is drawn as a Track's, with no season
// tabs, named rather than numbered, and the Trials in its rail; Leth Trial #1's, an Event
// board read once, too.
import { notFound } from "next/navigation";

import { BoardBody } from "./BoardBody";
import { DocTitle } from "../Behaviours";
import { PageHead } from "../PageHead";
import { Remember } from "../Trail";
import { BoardSheet } from "./BoardSheet";
import { OverallCard, PodiumPlates, ScorePlates, SortSwitch, TrackCard } from "./BoardTop";
import { HistoryCard } from "./HistoryCard";
import { PointsDialog } from "./PointsDialog";
import { RailItems } from "./Rail";
import { TrialRailItems } from "./TrialRail";
import { SeasonChip, SeasonTabs } from "./SeasonSwitch";
import {
  getBoardHistory,
  getBoardPage,
  getBoardPlaces,
  getPlacesOf,
  getBoardScores,
  getSite,
  getTrialTops,
} from "../../db/data";
import { YouBanner } from "./YouBanner";
import { YouMarks } from "./YouMarks";
import { TRACKS, TRIALS_GROUP, circuitBoard, trackNo, trialOf } from "../../lib/circuit";
import { seasonsOf } from "../../lib/player";
import { PODIUM_SORT, boardHref } from "../../lib/routes";
import { podiumRows } from "../../lib/podiums";
import { BOARD_CHUNK, countText, isPoints, isSteamId } from "../../lib/rules";

export async function CircuitBoardView({ name, slot }: { name: string; slot: string | null }) {
  if (!circuitBoard(name) || (slot && slot !== PODIUM_SORT && !isSteamId(slot))) notFound();
  const site = await getSite();
  const b = site.boards.find((x) => x.name === name);
  if (!b) notFound();
  const points = isPoints(name);
  const trial = b.group === TRIALS_GROUP;
  /* an Overall board shows its season's podium tally beside its points */
  const tally = points ? (site.podiums.find((s) => s.group === b.group) ?? null) : null;
  const podiums = slot === PODIUM_SORT && !!tally;
  const focusId = slot && isSteamId(slot) ? slot : null;
  const own = site.boards.filter((x) => x.group === b.group);
  const seasons = seasonsOf(site.boards);
  /* how many Tracks an Overall board adds up */
  const tracks = tally?.tracks ?? seasons.find((s) => s.group === b.group)?.tracks ?? 0;

  const none: Promise<Record<string, { rank: number; score: number }>> = Promise.resolve({});
  const [page, scores, places, focus, history, trials] = await Promise.all([
    getBoardPage(name, 0, BOARD_CHUNK),
    points ? Promise.resolve([]) : getBoardScores(name),
    podiums
      ? getPlacesOf(
          name,
          tally.players.map((p) => p.steamId),
        )
      : none,
    focusId ? getBoardPlaces(name, [focusId]) : none,
    points ? Promise.resolve(null) : getBoardHistory(name),
    trial ? getTrialTops() : Promise.resolve([]),
  ]);
  const rows = page.rows;
  const focusAt = focusId ? focus[focusId] : undefined;
  const t = TRACKS[name] as (typeof TRACKS)[string] | undefined;
  const items = trial ? (
    <TrialRailItems tops={trials} current={name} />
  ) : (
    <RailItems boards={own} current={name} podiums={site.podiums} />
  );
  /* the page's title: a season's standings by name, a Track by its in-game number, a Trial
     by its name */
  const title = points ? `${b.group} ${b.display}` : trial ? b.display : `Track ${b.display}`;
  const here = boardHref(name, podiums ? PODIUM_SORT : null);

  return (
    <>
      <PageHead path={here} title={title} />
      <div className="main">
        <DocTitle title={trial ? b.display : `${b.group} ${b.display}`} />
        {!trial && <SeasonTabs seasons={seasons} on={b.group} />}
        <aside className="rail">
          <h2 id="railhead">{b.group}</h2>
          <nav className="boards" id="boards" aria-label="Leaderboard">
            {items}
          </nav>
        </aside>

        <section className="content">
          <YouMarks name={name} />
          <div className="boardrow">
            <SeasonChip seasons={seasons} on={b.group} board={name} />
            <BoardSheet
              img={t?.img ?? trialOf(name)?.picture ?? null}
              name={points || trial ? b.display : trackNo(b.display)}
              count={countText(b)}
              group={b.group}
            >
              {items}
            </BoardSheet>
          </div>

          {points ? (
            <OverallCard b={b} rows={rows} tally={tally} tracks={tracks} podiums={podiums} />
          ) : (
            <TrackCard b={b} rows={rows} scores={scores} />
          )}

          {/* You on the points order only: the podium order ranks no one by score */}
          {!podiums && <YouBanner name={name} field={page.total} medals={t?.medals ?? null} />}

          {podiums ? (
            <BoardBody
              order="podiums"
              name={name}
              points
              where={b.group}
              count={b.entryCount}
              sortsw={<SortSwitch name={name} podiums />}
              leaders={<PodiumPlates tally={tally} />}
              players={podiumRows(tally, places)}
              tracks={tally.tracks}
              group={b.group}
            />
          ) : (
            <BoardBody
              order="score"
              name={name}
              points={points}
              where={b.group}
              count={page.total}
              sortsw={tally ? <SortSwitch name={name} podiums={false} /> : undefined}
              history={history && <HistoryCard h={history} />}
              leaders={<ScorePlates name={name} rows={rows} focus={focusId} />}
              initial={rows}
              lead={rows[0]?.score ?? null}
              pods={
                tally
                  ? Object.fromEntries(
                      tally.players.map((p) => [
                        p.steamId,
                        { gold: p.gold, silver: p.silver, bronze: p.bronze },
                      ]),
                    )
                  : null
              }
              focus={focusId && focusAt ? { id: focusId, rank: focusAt.rank } : null}
            />
          )}
        </section>
        {points && <PointsDialog board={name} tracks={tracks} />}
        <Remember
          trail="board"
          href={here}
          label={points || trial ? title : `${b.group} ${title}`}
        />
      </div>
    </>
  );
}
