// A Circuit board's page: the season switch, the season's boards in the rail (a sheet on a
// phone, beside the switch's chip), the card
// across the top, the history card and plates, and the list. `slot` is what follows the board's
// name in its path: a Steam ID whose row to find and mark, or on an Overall board
// "podiums" for its podium order.
import { notFound } from "next/navigation";

import { BoardBody } from "./BoardBody";
import { Remember } from "../BackLink";
import { DocTitle } from "../Behaviours";
import { BoardSheet } from "./BoardSheet";
import { OverallCard, PodiumPlates, ScorePlates, SortSwitch, TrackCard } from "./BoardTop";
import { HistoryCard } from "./HistoryCard";
import { PointsDialog } from "./PointsDialog";
import { RailItems } from "./Rail";
import { SeasonChip, SeasonTabs } from "./SeasonSwitch";
import {
  getBoardHistory,
  getBoardPage,
  getBoardPlaces,
  getPlacesOf,
  getBoardScores,
  getSite,
} from "../../db/data";
import { YouBanner } from "./YouBanner";
import { YouMarks } from "./YouMarks";
import { TRACKS, circuitBoard, trackNo } from "../../lib/circuit";
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
  /* an Overall board shows its season's podium tally beside its points */
  const tally = points ? (site.podiums.find((s) => s.group === b.group) ?? null) : null;
  const podiums = slot === PODIUM_SORT && !!tally;
  const focusId = slot && isSteamId(slot) ? slot : null;
  const own = site.boards.filter((x) => x.group === b.group);
  const seasons = seasonsOf(site.boards);
  /* how many Tracks an Overall board adds up */
  const tracks = tally?.tracks ?? seasons.find((s) => s.group === b.group)?.tracks ?? 0;

  const none: Promise<Record<string, { rank: number; score: number }>> = Promise.resolve({});
  const [page, scores, places, focus, history] = await Promise.all([
    getBoardPage(name, 0, BOARD_CHUNK + 3),
    points ? Promise.resolve([]) : getBoardScores(name),
    podiums
      ? getPlacesOf(
          name,
          tally.players.map((p) => p.steamId),
        )
      : none,
    focusId ? getBoardPlaces(name, [focusId]) : none,
    points ? Promise.resolve(null) : getBoardHistory(name),
  ]);
  const rows = page.rows;
  const focusAt = focusId ? focus[focusId] : undefined;
  const t = TRACKS[name] as (typeof TRACKS)[string] | undefined;
  const items = <RailItems boards={own} current={name} podiums={site.podiums} />;

  return (
    <div className="main">
      <DocTitle title={`${b.group} ${b.display}`} />
      <SeasonTabs seasons={seasons} on={b.group} />
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
            img={t?.img ?? null}
            name={points ? b.display : trackNo(b.display)}
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
            initial={page.total >= 3 ? rows.slice(3) : rows}
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
        href={boardHref(name, podiums ? PODIUM_SORT : null)}
        label={b.display}
      />
    </div>
  );
}
