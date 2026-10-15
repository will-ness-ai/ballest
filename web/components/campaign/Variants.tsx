// PROTOTYPE (grill-design, round 1: the Campaign page's overall layout). Never merged.
import Link from "next/link";

import { MapImage } from "../MapImage";
import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import type { CampaignRow } from "../../db/campaign";
import type { Campaign } from "../../lib/campaigns";
import type { WorkshopMap } from "../../lib/rows";
import { mapHref } from "../../lib/routes";
import { fmtN, fmtTime, personaOf } from "../../lib/rules";

interface P {
  c: Campaign;
  maps: Array<WorkshopMap>;
  rows: Array<CampaignRow>;
}

const short = (c: Campaign, m: WorkshopMap) =>
  m.title.replace(new RegExp("^" + c.title + "\\s*", "i"), "").trim() || m.title;

const SHOWN = 25;

function Head({ c, maps, rows, big }: P & { big?: boolean }) {
  return (
    <div className={"cp-head" + (big ? " big" : "")}>
      <span className="eyebrow">Campaign &middot; {maps.length} maps</span>
      <h1 className="cp-t">{c.title}</h1>
      <span className="cp-by">
        by <PlayerLink id={c.cid} text={c.creator} tab="made" />
      </span>
      <div className="cp-facts">
        <span>
          <b>{fmtN(rows.length)}</b>players
        </span>
        <span>
          <b>{fmtN(rows.filter((r) => r.finished === maps.length).length)}</b>finished all
        </span>
        <span>
          <b>{fmtN(maps.reduce((n, m) => n + m.entryCount, 0))}</b>runs
        </span>
      </div>
    </div>
  );
}

function Board({ maps, rows, title = "Campaign standings" }: P & { title?: string }) {
  return (
    <section className="cp-board">
      <div className="cp-bh">
        <h2>{title}</h2>
        <span className="cp-note">Circuit points: 40,000 for 1st on a map, summed</span>
      </div>
      <ol className="cp-rows">
        {rows.slice(0, SHOWN).map((r) => (
          <li key={r.steamId} className="cp-row" data-m={r.rank <= 3 ? r.rank : undefined}>
            <span className="cp-rk">{r.rank}</span>
            <Marble who={r} />
            <span className="cp-nm">
              <PlayerLink id={r.steamId} text={personaOf(r)} />
            </span>
            <span className={"cp-fin" + (r.finished === maps.length ? " all" : "")}>
              {r.finished}/{maps.length}
            </span>
            <span className="cp-pts num">{fmtN(r.score)}</span>
          </li>
        ))}
      </ol>
      {rows.length > SHOWN && <p className="cp-more">and {fmtN(rows.length - SHOWN)} more</p>}
    </section>
  );
}

function MapCardSmall({ c, m, i }: { c: Campaign; m: WorkshopMap; i: number }) {
  const lead = m.top3[0];
  return (
    <Link className="cp-mc" href={mapHref(m.pfid)}>
      <span className="cp-mi">
        <MapImage preview={m.preview} />
        <span className="cp-no">{i + 1}</span>
      </span>
      <span className="cp-mt">{short(c, m)}</span>
      {lead && (
        <span className="cp-ml">
          <Marble who={{ steamId: lead[0], persona: lead[1] }} still />
          <span>{lead[1]}</span>
          <span className="num">{fmtTime(lead[2])}</span>
        </span>
      )}
    </Link>
  );
}

/* A: the Circuit's own shape, the Maps in a rail where the Circuit lists its Tracks */
function A(p: P) {
  return (
    <div className="cp cp-A">
      <aside className="cp-rail">
        <Head {...p} />
        <nav className="cp-rlist">
          {p.maps.map((m, i) => (
            <Link key={m.pfid} className="cp-ri" href={mapHref(m.pfid)}>
              <MapImage preview={m.preview} />
              <span className="cp-no">{String(i + 1).padStart(2, "0")}</span>
              <span className="cp-rt">{short(p.c, m)}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <Board {...p} />
    </div>
  );
}

/* B: a banner of every Map's picture, the Maps as a strip of cards, the standings under */
function B(p: P) {
  return (
    <div className="cp cp-B">
      <div className="cp-banner">
        <div className="cp-collage">
          {p.maps.slice(0, 5).map((m) => (
            <MapImage key={m.pfid} preview={m.preview} />
          ))}
        </div>
        <Head {...p} big />
      </div>
      <div className="cp-strip">
        {p.maps.map((m, i) => (
          <MapCardSmall key={m.pfid} c={p.c} m={m} i={i} />
        ))}
      </div>
      <Board {...p} />
    </div>
  );
}

/* C: one header, then tabs: Standings or Maps, one at a time */
function C(p: P) {
  return (
    <div className="cp cp-C">
      <div className="cp-chead">
        <MapImage preview={p.maps[0]?.preview} className="cp-cimg" />
        <Head {...p} />
      </div>
      <div className="cp-tabs" role="tablist">
        <input type="radio" name="cpt" id="cpt1" defaultChecked />
        <label htmlFor="cpt1">Standings</label>
        <input type="radio" name="cpt" id="cpt2" />
        <label htmlFor="cpt2">Maps ({p.maps.length})</label>
        <div className="cp-tab1">
          <Board {...p} />
        </div>
        <div className="cp-tab2 cp-grid">
          {p.maps.map((m, i) => (
            <MapCardSmall key={m.pfid} c={p.c} m={m} i={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* D: a results sheet, a column per Map with each player's place on it, the total last */
function D(p: P) {
  return (
    <div className="cp cp-D">
      <Head {...p} />
      <div className="cp-sheet">
        <table>
          <thead>
            <tr>
              <th className="sk">#</th>
              <th className="sk2">Player</th>
              {p.maps.map((m, i) => (
                <th key={m.pfid} className="mh">
                  <Link href={mapHref(m.pfid)} title={m.title}>
                    <MapImage preview={m.preview} />
                    <span>{i + 1}</span>
                  </Link>
                </th>
              ))}
              <th className="tot">Points</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.slice(0, SHOWN).map((r) => (
              <tr key={r.steamId}>
                <td className="sk">{r.rank}</td>
                <td className="sk2">
                  <span className="cp-nm2">
                    <Marble who={r} />
                    <PlayerLink id={r.steamId} text={personaOf(r)} />
                  </span>
                </td>
                {p.maps.map((m) => {
                  const part = r.parts[m.name];
                  return (
                    <td key={m.pfid} className="pl" data-m={part && part[0] <= 3 ? part[0] : undefined}>
                      {part ? part[0] : "–"}
                    </td>
                  );
                })}
                <td className="tot num">{fmtN(r.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.rows.length > SHOWN && <p className="cp-more">and {fmtN(p.rows.length - SHOWN)} more</p>}
      <p className="cp-note">Each cell is the player&apos;s place on that map. Circuit points, summed.</p>
    </div>
  );
}

/* E: the standings lead, a podium of the top three; the Maps fold into one line */
function E(p: P) {
  const top = p.rows.slice(0, 3);
  return (
    <div className="cp cp-E">
      <Head {...p} />
      <div className="cp-pod">
        {[1, 0, 2].map((i) => {
          const r = top[i];
          if (!r) return <span key={i} />;
          return (
            <div key={r.steamId} className="cp-step" data-m={i + 1}>
              <Marble who={r} />
              <b>
                <PlayerLink id={r.steamId} text={personaOf(r)} />
              </b>
              <span className="num">{fmtN(r.score)}</span>
              <i>{i + 1}</i>
            </div>
          );
        })}
      </div>
      <details className="cp-fold">
        <summary>
          {p.maps.length} maps: {p.maps.map((m) => short(p.c, m)).join(" · ")}
        </summary>
        <div className="cp-grid">
          {p.maps.map((m, i) => (
            <MapCardSmall key={m.pfid} c={p.c} m={m} i={i} />
          ))}
        </div>
      </details>
      <Board {...p} rows={p.rows.slice(3)} title="The rest" />
    </div>
  );
}

export const VARIANTS = [
  { key: "A", name: "Circuit twin", note: "Maps in a rail like the Circuit's Tracks, standings beside them.", C: A },
  { key: "B", name: "Banner and strip", note: "Collage banner, a strip of numbered Map cards, standings under.", C: B },
  { key: "C", name: "Tabs", note: "Header, then Standings or Maps tabs, one at a time.", C: C },
  { key: "D", name: "Results sheet", note: "One table: a column per Map with each player's place, points last.", C: D },
  { key: "E", name: "Podium first", note: "Top three on a podium, Maps folded into one line, the rest below.", C: E },
] as const;

export function CampaignVariants(p: P) {
  return (
    <>
      {VARIANTS.map(({ key, C: V }) => (
        <div key={key} className={"cpv cpv-" + key}>
          <V {...p} />
        </div>
      ))}
    </>
  );
}
