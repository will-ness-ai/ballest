// PROTOTYPE (grill-design round 2: the Circuit twin). Never merged. A Campaign's page built
// from the Circuit board's own pieces: the Campaign switch where the season switch is, its
// Maps down the rail where the Tracks are, the Overall card and plates, and the list.
import Link from "next/link";
import { notFound } from "next/navigation";

import { campaignCards } from "./HomeEntry";
import { Picker } from "./Picker";
import { Remember } from "../BackLink";
import { DocTitle } from "../Behaviours";
import { PlayerLink } from "../PlayerLink";
import { BoardBody } from "../board/BoardBody";
import { BoardSheet } from "../board/BoardSheet";
import { OverallCard, PodiumPlates, ScorePlates, SortSwitch } from "../board/BoardTop";
import { HistoryCard } from "../board/HistoryCard";
import { PointsDialog } from "../board/PointsDialog";
import { SeasonMenu } from "../board/SeasonMenu";
import { YouBanner } from "../board/YouBanner";
import { YouMarks } from "../board/YouMarks";
import { YouSpread } from "../board/YouSpread";
import {
  getBoardHistory,
  getBoardPage,
  getBoardPlaces,
  getBoardScores,
  getCampaignData,
  getPlacesOf,
} from "../../db/data";
import {
  CAMPAIGNS,
  campaignBoard,
  campaignHref,
  campaignMapHref,
  campaignOf,
  shortTitle,
  type Campaign,
} from "../../lib/campaigns";
import type { IndexBoard } from "../../lib/player";
import { podiumRows, tally } from "../../lib/podiums";
import { PODIUM_SORT, mapHref } from "../../lib/routes";
import {
  BOARD_CHUNK,
  countText,
  fmtN,
  fmtTime,
  isSteamId,
  personaOf,
  plural,
} from "../../lib/rules";
import type { BoardRow, WorkshopMap } from "../../lib/rows";
import { spreadOf } from "../../lib/spread";

const no = (i: number) => String(i + 1).padStart(2, "0");

function CampaignTabs({ on, list }: { on: Campaign; list: Array<Campaign> }) {
  return (
    <nav className="seasontabs" aria-label="Campaign">
      {list.map((c) => (
        <Link key={c.slug} href={campaignHref(c.slug)} aria-current={c.slug === on.slug}>
          {c.title}
        </Link>
      ))}
    </nav>
  );
}

function CampaignChip({ on, board, list }: { on: Campaign; board: string; list: Array<Campaign> }) {
  return (
    <SeasonMenu id={`campaigns-${board}`} label={on.title}>
      {list.map((c) => (
        <Link key={c.slug} href={campaignHref(c.slug)} aria-current={c.slug === on.slug}>
          <b>{c.title}</b>
          <small>
            {c.maps.length} Maps · by {c.creator}
          </small>
        </Link>
      ))}
    </SeasonMenu>
  );
}

/* the rail: Overall in words, then each Map as a strip of its picture with its record.
   Variant A keeps a Map inside the Campaign's frame, B opens its own Map page */
function RailItems({
  c,
  maps,
  current,
  players,
}: {
  c: Campaign;
  maps: Array<WorkshopMap>;
  current: string | null;
  players: number;
}) {
  return (
    <>
      <Link className="tstrip plain" href={campaignHref(c.slug)} aria-current={current === null}>
        <span className="lab">
          <b>Overall</b> <small>{plural(players, "player", "players")}</small>
        </span>
      </Link>
      {maps.map((m, i) =>
        (["A", "B"] as const).map((v) => (
          <Link
            key={m.pfid + v}
            className={"tstrip pv-" + v}
            href={v === "A" ? campaignMapHref(c, m.pfid) : mapHref(m.pfid)}
            aria-current={current === m.pfid}
          >
            {m.preview && <img src={m.preview} alt="" loading="lazy" decoding="async" />}{" "}
            <span className="lab">
              <b>{no(i)}</b>
              <span className="rt">{m.top3[0] ? fmtTime(m.top3[0][2]) : "\u00a0"}</span>{" "}
              <small>
                <span className="cmn">{shortTitle(c, m.title)}</span> ·{" "}
                {plural(m.entryCount, "run", "runs")}
              </small>
            </span>
          </Link>
        )),
      )}
    </>
  );
}

function Facts({ facts }: { facts: ReadonlyArray<[string, React.ReactNode]> }) {
  return (
    <dl className="bc-facts">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* where a Track has its card, a Map in the Campaign has its picture, facts and spread */
function MapBoardCard({
  c,
  m,
  i,
  rows,
  scores,
}: {
  c: Campaign;
  m: WorkshopMap;
  i: number;
  rows: Array<BoardRow>;
  scores: ReadonlyArray<number>;
}) {
  const lead = rows[0] as BoardRow | undefined;
  return (
    <div className={m.preview ? "bcard" : "bcard nopic"} id="bcard">
      {m.preview && <img className="bc-pic" src={m.preview} alt="" />}
      <div className="bc-body">
        <div className="bc-top">
          <div>
            <h1>
              {no(i)} {shortTitle(c, m.title)}
            </h1>
            <span className="bc-by">
              {c.title} · <Link href={mapHref(m.pfid)}>Map page</Link>
            </span>
          </div>
          <Facts
            facts={[
              ["Runs", fmtN(m.entryCount)],
              ["Record", lead ? fmtTime(lead.score) : "—"],
              [
                "Record holder",
                lead ? <PlayerLink id={lead.steamId} text={personaOf(lead)} /> : "—",
              ],
            ]}
          />
        </div>
        <YouSpread name={m.name} chart={spreadOf(scores, m.medals, false)} />
        <p className="bc-cap">Workshop preview picture.</p>
      </div>
    </div>
  );
}

export async function CampaignView({ slug, slot }: { slug: string; slot: string | null }) {
  const c = campaignOf(slug);
  const data = c && (await getCampaignData(slug));
  if (!c || !data) notFound();
  const { maps, placings } = data;
  const list = (await campaignCards()).map((k) => k.c);
  const mapAt = slot ? maps.findIndex((m) => m.pfid === slot) : -1;
  const m = mapAt >= 0 ? maps[mapAt] : null;
  if (slot && !m && slot !== PODIUM_SORT && !isSteamId(slot)) notFound();
  const name = m ? m.name : campaignBoard(c);
  const podiums = !m && slot === PODIUM_SORT;
  const focusId = !m && slot && isSteamId(slot) ? slot : null;
  const t = tally(
    c.title,
    maps.map((x) => x.name),
    placings,
    (n) => {
      const k = maps.findIndex((x) => x.name === n);
      return k >= 0 ? no(k) + " " + shortTitle(c, maps[k].title) : n;
    },
  );

  const none: Promise<Record<string, { rank: number; score: number }>> = Promise.resolve({});
  const [page, overall, scores, places, focus, history] = await Promise.all([
    getBoardPage(name, 0, BOARD_CHUNK + 3),
    getBoardPage(campaignBoard(c), 0, 1),
    m ? getBoardScores(name) : Promise.resolve([]),
    podiums
      ? getPlacesOf(
          name,
          t.players.map((p) => p.steamId),
        )
      : none,
    focusId ? getBoardPlaces(name, [focusId]) : none,
    m ? getBoardHistory(name) : Promise.resolve(null),
  ]);
  const rows = page.rows;
  const b: IndexBoard = {
    name,
    group: c.title,
    tier: null,
    display: m ? shortTitle(c, m.title) : "Overall",
    entryCount: page.total,
  };
  const focusAt = focusId ? focus[focusId] : undefined;
  const items = <RailItems c={c} maps={maps} current={m?.pfid ?? null} players={overall.total} />;

  return (
    <div className="main">
      <DocTitle title={`${c.title} ${b.display}`} />
      <CampaignTabs on={c} list={list} />
      <aside className="rail">
        <h2 id="railhead">{c.title}</h2>
        <p className="cby">
          A Campaign by <PlayerLink id={c.cid} text={c.creator} tab="made" />
        </p>
        <nav className="boards" id="boards" aria-label="Leaderboard">
          {items}
        </nav>
      </aside>

      <section className="content">
        <YouMarks name={name} />
        <div className="boardrow">
          <CampaignChip on={c} board={name} list={list} />
          <BoardSheet
            img={m?.preview ?? null}
            name={m ? no(mapAt) + " " + b.display : "Overall"}
            count={countText(b)}
            group={c.title}
          >
            {items}
          </BoardSheet>
        </div>

        {m ? (
          <MapBoardCard c={c} m={m} i={mapAt} rows={rows} scores={scores} />
        ) : (
          <OverallCard
            b={b}
            rows={rows}
            tally={t}
            tracks={maps.length}
            podiums={podiums}
            unit="maps"
          />
        )}

        {!podiums && <YouBanner name={name} field={page.total} medals={m?.medals ?? null} />}

        {podiums ? (
          <BoardBody
            order="podiums"
            name={name}
            points
            where={c.title}
            count={page.total}
            sortsw={<SortSwitch name={name} podiums />}
            leaders={<PodiumPlates tally={t} />}
            players={podiumRows(t, places)}
            tracks={t.tracks}
            group={c.title}
          />
        ) : (
          <BoardBody
            order="score"
            name={name}
            points={!m}
            where={c.title}
            count={page.total}
            sortsw={!m ? <SortSwitch name={name} podiums={false} /> : undefined}
            history={history && <HistoryCard h={history} />}
            leaders={<ScorePlates name={name} rows={rows} focus={focusId} />}
            initial={page.total >= 3 ? rows.slice(3) : rows}
            lead={rows[0]?.score ?? null}
            pods={
              !m
                ? Object.fromEntries(
                    t.players.map((p) => [
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
      {!m && <PointsDialog board={name} tracks={maps.length} unit="maps" />}
      <Remember trail="board" href={campaignHref(c.slug)} label={c.title} />
      <Picker
        variants={[
          {
            key: "A",
            name: "Maps stay in the Campaign",
            note: "A Map in the rail opens its board inside the Campaign's frame, like a Track.",
          },
          {
            key: "B",
            name: "Maps open their page",
            note: "A Map in the rail opens its usual Map page (rail gone).",
          },
        ]}
        states={CAMPAIGNS.map((x) => [x.title, campaignHref(x.slug)])}
      />
    </div>
  );
}
