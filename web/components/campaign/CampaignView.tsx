// A Campaign's page, a Circuit season's twin built from the same pieces
// (components/board/CircuitBoardView): the Campaign switch where the season switch is, its
// Maps down the rail where the Tracks are, the Overall card in maps with the podium tally,
// the plates and the list. `slot` is what follows the slug in the path: one of its Maps,
// opened inside the Campaign's frame as a Track opens inside its season; "podiums" for the
// podium order; or a Steam ID whose row to find and mark, on its own or after an Event's id.
import { notFound } from "next/navigation";

import { ProtoPicker, ProtoRailHow, ProtoRowGet, ProtoWsContent } from "../prototype/WsLinks";
import { mapName, mapNo } from "../../lib/campaigns";
import { safeImg } from "../../lib/rules";

import { CampaignRailItems } from "./CampaignRail";
import { CampaignChip } from "./CampaignSwitch";
import { Remember } from "../BackLink";
import { DocTitle } from "../Behaviours";
import { PlayerLink } from "../PlayerLink";
import { BoardBody } from "../board/BoardBody";
import { BoardSheet } from "../board/BoardSheet";
import {
  CampaignMapCard,
  OverallCard,
  PodiumPlates,
  ScorePlates,
  SortSwitch,
} from "../board/BoardTop";
import { HistoryCard } from "../board/HistoryCard";
import { PointsDialog } from "../board/PointsDialog";
import { YouBanner } from "../board/YouBanner";
import { YouMarks } from "../board/YouMarks";
import {
  getBoardHistory,
  getBoardPage,
  getBoardPlaces,
  getBoardScores,
  getCampaign,
  getCampaigns,
  getPlacesOf,
} from "../../db/data";
import { campaignBoard, eventOf, mapLabel } from "../../lib/campaigns";
import type { IndexBoard } from "../../lib/player";
import { podiumRows } from "../../lib/podiums";
import { PODIUM_SORT, boardHref, campaignHref, campaignSlot } from "../../lib/routes";
import { BOARD_CHUNK, countText } from "../../lib/rules";

export async function CampaignView({
  slug,
  slot,
  row = null,
}: {
  slug: string;
  slot: string | null;
  /* a Steam ID after an Event's id: the row to mark on the Event's board */
  row?: string | null;
}) {
  const [data, list] = await Promise.all([getCampaign(slug), getCampaigns()]);
  if (!data) notFound();
  const { c, maps, players, tally } = data;
  const at = campaignSlot(c, slot, row);
  if (!at) notFound();
  const { focus: focusId, podiums } = at;
  /* one of its Maps the Workshop no longer lists is no page */
  const m = at.map ? maps.find((x) => x.pfid === at.map) : undefined;
  if (at.map && !m) notFound();
  const overall = campaignBoard(c);
  const name = m ? m.name : overall;

  const none: Promise<Record<string, { rank: number; score: number }>> = Promise.resolve({});
  const [page, scores, places, focus, history] = await Promise.all([
    getBoardPage(name, 0, BOARD_CHUNK + 3),
    m ? getBoardScores(name) : Promise.resolve([]),
    podiums
      ? getPlacesOf(
          name,
          tally.players.map((p) => p.steamId),
        )
      : none,
    focusId ? getBoardPlaces(name, [focusId]) : none,
    m ? getBoardHistory(name) : Promise.resolve(null),
  ]);
  const rows = page.rows;
  const focusAt = focusId ? focus[focusId] : undefined;
  const title = m ? mapLabel(c, m.pfid, m.title) : "Overall";
  const b: IndexBoard = {
    name,
    group: c.title,
    tier: null,
    display: "Overall",
    entryCount: m ? m.entryCount : page.total,
  };
  const items = <CampaignRailItems c={c} maps={maps} current={name} players={players} />;

  return (
    <div className="main">
      <DocTitle title={`${c.title} ${title}`} />
      <aside className="rail">
        <h2 id="railhead">Campaign</h2>
        <CampaignChip list={list} on={c} board={`rail-${name}`} />
        <p className="railby">
          by <PlayerLink id={c.creatorId} text={c.creator} tab="made" />
        </p>
        {/* PROTOTYPE */}
        <ProtoRailHow n={maps.length} />
        <nav className="boards" id="boards" aria-label="Leaderboard">
          {items}
        </nav>
      </aside>

      <section className="content">
        <YouMarks name={name} />
        {/* PROTOTYPE */}
        <ProtoRowGet n={maps.length} at="above" />
        <div className="boardrow named">
          <CampaignChip list={list} on={c} board={name} />
          <BoardSheet img={m?.preview ?? null} name={title} count={countText(b)} group={c.title}>
            {items}
          </BoardSheet>
          <ProtoRowGet n={maps.length} at="row" />
        </div>

        {m ? (
          <CampaignMapCard m={m} title={title} group={c.title} rows={rows} scores={scores} />
        ) : (
          <OverallCard b={b} rows={rows} tally={tally} tracks={maps.length} podiums={podiums} />
        )}

        {/* PROTOTYPE */}
        <ProtoWsContent
          slug={c.slug}
          title={c.title}
          makerId={c.creatorId}
          maps={maps.map((x) => ({
            pfid: x.pfid,
            no: mapNo(c, x.pfid),
            name: mapName(c, x.pfid, x.title),
            pic: safeImg(x.preview),
          }))}
        />
        <ProtoPicker />

        {/* You on the points order only: the podium order ranks no one by score */}
        {!podiums && (
          <YouBanner
            name={name}
            field={page.total}
            medals={m && !eventOf(m.pfid) ? m.medals : null}
          />
        )}

        {podiums ? (
          <BoardBody
            order="podiums"
            name={name}
            points
            where={c.title}
            count={page.total}
            sortsw={<SortSwitch name={name} podiums />}
            leaders={<PodiumPlates tally={tally} />}
            players={podiumRows(tally, places)}
            tracks={tally.tracks}
            group={c.title}
          />
        ) : (
          <BoardBody
            order="score"
            name={name}
            points={!m}
            where={c.title}
            count={page.total}
            sortsw={m ? undefined : <SortSwitch name={name} podiums={false} />}
            history={history && <HistoryCard h={history} />}
            leaders={<ScorePlates name={name} rows={rows} focus={focusId} />}
            initial={page.total >= 3 ? rows.slice(3) : rows}
            lead={rows[0]?.score ?? null}
            pods={
              m
                ? null
                : Object.fromEntries(
                    tally.players.map((p) => [
                      p.steamId,
                      { gold: p.gold, silver: p.silver, bronze: p.bronze },
                    ]),
                  )
            }
            focus={focusId && focusAt ? { id: focusId, rank: focusAt.rank } : null}
          />
        )}
      </section>
      {!m && <PointsDialog board={name} tracks={maps.length} />}
      <Remember
        trail="board"
        href={m ? campaignHref(c.slug, m.pfid) : boardHref(name, podiums ? PODIUM_SORT : null)}
        label={c.title + " " + title}
      />
    </div>
  );
}
