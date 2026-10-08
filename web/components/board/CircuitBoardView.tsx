// A Circuit board's page: the season's boards in the rail (a sheet on a phone), the card
// across the top, the tiles and plates, and the list. `slot` is what follows the board's
// name in its path: a Steam ID whose row to find and mark, or on an Overall board
// "podiums" for its podium order.
import { notFound } from "next/navigation";

import { BoardBody } from "./BoardBody";
import { Remember } from "../BackLink";
import { DocTitle } from "../Behaviours";
import { BoardSheet } from "./BoardSheet";
import { OverallCard, PodiumPlates, ScorePlates, SortSwitch, Tiles, TrackCard } from "./BoardTop";
import { HistoryCard } from "./HistoryCard";
import { PointsDialog } from "./PointsDialog";
import { RailItems } from "./Rail";
import {
  getBoardHistory,
  getBoardPage,
  getBoardPlaces,
  getBoardScores,
  getSite,
} from "../../db/data";
import { TRACKS, circuitBoard, trackNo } from "../../lib/circuit";
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
  /* how many Tracks an Overall board adds up: its season's, or for All Seasons, which has
     none of its own, every Track */
  const tracks =
    tally?.tracks ??
    (own.filter((x) => !isPoints(x.name)).length ||
      site.boards.filter((x) => !isPoints(x.name)).length);

  const none: Promise<Record<string, { rank: number; score: number }>> = Promise.resolve({});
  const [page, scores, places, focus, history] = await Promise.all([
    getBoardPage(name, 0, BOARD_CHUNK + 3),
    points ? Promise.resolve([]) : getBoardScores(name),
    podiums
      ? getBoardPlaces(
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
      <aside className="rail">
        <h2 id="railhead">{b.group}</h2>
        <nav className="boards" id="boards" aria-label="Leaderboard">
          {items}
        </nav>
      </aside>

      <section className="content">
        <BoardSheet
          img={t?.img ?? null}
          name={points ? b.display : trackNo(b.display)}
          count={countText(b)}
          group={b.group}
        >
          {items}
        </BoardSheet>

        {points ? (
          <OverallCard b={b} rows={rows} tally={tally} tracks={tracks} podiums={podiums} />
        ) : (
          <TrackCard b={b} rows={rows} scores={scores} />
        )}

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
            tiles={<Tiles name={name} rows={rows} count={page.total} />}
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
