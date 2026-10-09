// A player's page: who they are, Sign out on your own and the score card on anyone else's,
// the tabs, and the tab on screen. Everything comes from one PlayerRecord (lib/player.ts) but the Daily tab,
// which is their Daily record over every Daily; the Circuit tab is drawn here, the
// Workshop and Made tabs are client components over the record.
import Link from "next/link";

import { CompareButton } from "./Compare";
import { DailyTab } from "./DailyTab";
import { MadeTab } from "./MadeTab";
import { ScoreCard, SignOut } from "./Me";
import { WorkshopTab } from "./WorkshopTab";
import { BackLink } from "../BackLink";
import { Marble } from "../Marble";
import { MedalCounts } from "../MedalCounts";
import { SteamMark } from "../SteamMark";
import type { PlayerRecord, SeasonRecord, TrackTile } from "../../lib/player";
import type { DailyCell, PlayerDailies } from "../../lib/rows";
import { boardHref, playerHref, type PlayerTab } from "../../lib/routes";
import { fmtN, fmtTime, ord, pctOf, personaOf, plural, safeUrl, shortGap } from "../../lib/rules";

/* a player's page's tabs, in order; Made only for someone who published a Map */
const TABS: ReadonlyArray<{
  key: PlayerTab;
  label: string;
  count: (rec: PlayerRecord, daily: PlayerDailies) => number;
  shown?: (rec: PlayerRecord) => boolean;
}> = [
  { key: "circuit", label: "Circuit", count: (rec) => rec.run },
  { key: "workshop", label: "Workshop", count: (rec) => rec.workshop.finishes.length },
  {
    key: "made",
    label: "Made",
    count: (rec) => rec.made.length,
    shown: (rec) => rec.made.length > 0,
  },
  { key: "daily", label: "Daily", count: (_, daily) => daily.played.length },
];

const tabsOf = (rec: PlayerRecord) => TABS.filter((t) => !t.shown || t.shown(rec));

/* the tab a path asks for, or the player's home tab when it names none they have */
export const tabFor = (rec: PlayerRecord, want: string | null): PlayerTab =>
  tabsOf(rec).find((t) => t.key === want)?.key ?? rec.home;

function Tile({ t, id }: { t: TrackTile; id: string }) {
  const f = t.finish;
  if (!f)
    return (
      <span className="ptile untimed">
        <span className="pt-name">{t.display}</span> <span className="pt-rank">&mdash;</span>
        <span className="pt-time">no time</span>
      </span>
    );
  const w = Math.max(0, Math.round((1 - (f.rank - 1) / t.field) * 100));
  return (
    <Link className="ptile" data-m={f.rank <= 3 ? f.rank : 0} href={boardHref(t.name, id)}>
      <span className="pt-name">{t.display}</span>{" "}
      <span className="pt-line">
        <span className="pt-rank">
          {f.rank}
          <sup>{ord(f.rank).slice(-2)}</sup>
          <span className="pt-of">{"/" + fmtN(t.field)}</span>
        </span>{" "}
        <span className="pt-gap">{f.rank === 1 ? "record" : shortGap(f.score - f.lead)}</span>
      </span>{" "}
      <span className="pt-time">
        {fmtTime(f.score)}
        <span className="pt-pts">{fmtN(t.points) + " pts"}</span>
      </span>{" "}
      <span className="pt-pct">{pctOf(f.rank, t.field)}</span>{" "}
      <span className="pt-bar">
        <i style={{ "--w": String(w) + "%" } as React.CSSProperties}></i>
      </span>
    </Link>
  );
}

function Season({ s, id }: { s: SeasonRecord; id: string }) {
  return (
    <section className="pseason">
      <div className="pslab">
        <h2>{s.group}</h2>{" "}
        {s.overall ? (
          <span className="pov" data-m={s.overall.rank <= 3 ? s.overall.rank : 0}>
            <b>{ord(s.overall.rank)}</b>
            {` overall · ${fmtN(s.overall.score)} pts`}
          </span>
        ) : (
          <span className="pov">not ranked overall</span>
        )}
      </div>{" "}
      {s.lagging ? (
        <p className="psync">
          Steam&apos;s leaderboard takes a while to sync. These tracks add up to{" "}
          <b>{fmtN(s.points)}</b> pts.
        </p>
      ) : null}{" "}
      {s.tiers.map((t) => (
        <div className="ptier" key={t.tier}>
          <span className="ptlab">
            {t.tier}
            {s.tiers.length > 1 ? (
              <span className="ptsum">
                <b>{fmtN(t.points)}</b> pts
              </span>
            ) : null}
          </span>{" "}
          <div className="pgrid">
            {t.tracks.map((x) => (
              <Tile key={x.name} t={x} id={id} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function CircuitTab({ rec }: { rec: PlayerRecord }) {
  return (
    <>
      <dl className="pstats">
        <div className="pstat">
          <dt>World records</dt>
          <dd>
            {rec.medals.gold} <small>{rec.golds.length ? rec.golds.join(", ") : "none yet"}</small>
          </dd>
        </div>{" "}
        <div className="pstat">
          <dt>Podiums</dt>
          <dd>
            <MedalCounts p={rec.medals} /> <small>gold, silver, bronze</small>
          </dd>
        </div>{" "}
        <div className="pstat">
          <dt>Tracks run</dt>
          <dd>
            {fmtN(rec.run) + " "}
            <small>{`of ${fmtN(rec.tracks)} on the Circuit`}</small>
          </dd>
        </div>{" "}
        <div className="pstat">
          <dt>All seasons</dt>
          <dd>
            {rec.allSeasons ? ord(rec.allSeasons.rank) : "—"}{" "}
            <small>
              {rec.allSeasons ? fmtN(rec.allSeasons.score) + " points" : "no season points"}
            </small>
          </dd>
        </div>
      </dl>{" "}
      {rec.seasons.map((s) => (
        <Season key={s.group} s={s} id={rec.id} />
      ))}
    </>
  );
}

export function PlayerView({
  rec,
  tab,
  daily,
}: {
  rec: PlayerRecord;
  tab: PlayerTab;
  /* their Daily record, and every Daily for its calendar */
  daily: { mine: PlayerDailies; days: ReadonlyArray<DailyCell> };
}) {
  const url = safeUrl(rec.profileUrl);
  return (
    <div className="main">
      <section className="content">
        <div className="pp" id="player">
          <BackLink trail="board" />{" "}
          <div className="pid">
            <Marble who={rec.who} />{" "}
            <span className="pwho">
              <h1>{personaOf(rec.who)}</h1>{" "}
              <span className="pline">
                {rec.allSeasons ? (
                  <>
                    <b>{ord(rec.allSeasons.rank)}</b>
                    {` across all seasons · ${fmtN(rec.allSeasons.score)} pts`}
                  </>
                ) : (
                  "Not on the all-seasons board"
                )}
              </span>{" "}
              {rec.made.length ? (
                <>
                  <br />
                  <span className="maker">
                    {"Map maker · " + plural(rec.made.length, "map", "maps")}
                  </span>
                </>
              ) : null}{" "}
              <SignOut id={rec.id} />
            </span>{" "}
            <CompareButton keep={rec.who} />{" "}
            {url ? (
              <a className="steam" href={url} target="_blank" rel="noopener">
                <SteamMark />
                Steam profile
              </a>
            ) : null}
          </div>{" "}
          <ScoreCard rec={rec} />{" "}
          <nav className="ptabs">
            {tabsOf(rec).map((t) => (
              <Link
                key={t.key}
                href={playerHref(rec.id, t.key)}
                scroll={false}
                aria-current={t.key === tab ? "page" : undefined}
              >
                {t.label}
                <small>{fmtN(t.count(rec, daily.mine))}</small>
              </Link>
            ))}
          </nav>{" "}
          {tab === "circuit" ? (
            <CircuitTab rec={rec} />
          ) : tab === "workshop" ? (
            <WorkshopTab id={rec.id} w={rec.workshop} />
          ) : tab === "daily" ? (
            <DailyTab mine={daily.mine} days={daily.days} />
          ) : (
            <MadeTab id={rec.id} made={rec.made} holds={rec.holds} />
          )}
        </div>
      </section>
    </div>
  );
}
