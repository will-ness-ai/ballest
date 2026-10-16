"use client";
// The four ladder cards on /you (lib/ladder.ts). The page arrives with each list's top 3;
// once the browser knows You, it reads You's cards from GET /api/standings?ladders, which adds
// the players around You and the line under each card. Gains and moves count from the /you
// baseline by the reader's clock, so the server's are shown only when its baseline is that
// one, and otherwise the cards are read again. "Show all" opens the whole list in the card,
// read in slices from GET /api/standings?list=, scrolled to You.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { useNow } from "../../hooks/client";
import { useYou } from "../../hooks/me";
import { readOnce, useRead } from "../../hooks/read";
import { dayLabel } from "../../lib/daily";
import {
  STANDINGS_STATS,
  STANDINGS_TITLE,
  chaseText,
  placeText,
  type Ladder,
  type LadderRow,
  type YouLadders,
} from "../../lib/ladder";
import type { StandingsStat } from "../../lib/rows";
import { signInHref, youHref } from "../../lib/routes";
import { BOARD_CHUNK, fmtN, isSteamId, personaOf, relTime } from "../../lib/rules";
import { youBaseline } from "../../lib/workshop-standings";

/* the key for nobody signed in */
const NOBODY = "-";

/* You's cards, or (NOBODY) the top 3s, against the /you baseline by the server's clock */
const readLadders = readOnce(async (key): Promise<YouLadders> => {
  const r = await fetch(
    "/api/standings?ladders" + (key !== NOBODY && isSteamId(key) ? "&player=" + key : ""),
  );
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as YouLadders;
});

async function readSlice(stat: StandingsStat, since: string, from: number, count: number) {
  const q = new URLSearchParams({
    list: stat,
    since,
    from: String(from),
    count: String(count),
  });
  const r = await fetch("/api/standings?" + q.toString());
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as { total: number; rows: Array<LadderRow> };
}

/* "Tue, Oct 14, 16:00 UTC" */
const sinceText = (iso: string) => `${dayLabel(iso.slice(0, 10))}, ${iso.slice(11, 16)} UTC`;

/* +N since the baseline, leading, then the places moved, smaller */
function Change({ r }: { r: LadderRow }) {
  const up = r.move !== null && r.move > 0,
    down = r.move !== null && r.move < 0;
  return (
    <span className="yl-ch">
      {r.gain !== 0 && (
        <span className="yl-gain" data-down={r.gain < 0 || undefined}>
          {r.gain > 0 ? "+" : "−"}
          {fmtN(Math.abs(r.gain))}
        </span>
      )}
      {r.move === null ? (
        <small className="yl-move" data-dir="new">
          new
        </small>
      ) : (
        (up || down) && (
          <small className="yl-move" data-dir={up ? "up" : "down"}>
            <span aria-hidden="true">{up ? "▲" : "▼"}</span>
            <span className="yl-sr">{up ? " up " : " down "}</span>
            {fmtN(Math.abs(r.move))}
          </small>
        )
      )}
    </span>
  );
}

function Row({ r, you, moves }: { r: LadderRow; you: boolean; moves: boolean }) {
  return (
    <li className="yl-row" data-you={you || undefined}>
      <span className="yl-pl">{placeText(r)}</span>
      <Marble who={r} still />
      <span className="yl-nm">
        <PlayerLink id={r.steamId} text={personaOf(r)} tab="workshop" />
      </span>
      <b className="yl-n">{fmtN(r.n)}</b>
      {moves ? <Change r={r} /> : <span className="yl-ch" />}
    </li>
  );
}

/* the whole list, opened in the card: read down to You in one go, then a few chunks at a
   time as it scrolls, and scrolled to You once it lands */
function AllRows({
  stat,
  since,
  at,
  you,
}: {
  stat: StandingsStat;
  since: string;
  at: number | null;
  you: string | null;
}) {
  const [got, setGot] = useState<{ total: number; rows: Array<LadderRow> } | null>(null);
  const reading = useRef(false);
  const box = useRef<HTMLOListElement>(null);
  const placed = useRef(false);

  const more = useCallback(
    (from: number, count: number) => {
      if (reading.current) return;
      reading.current = true;
      readSlice(stat, since, from, count).then(
        (s) => {
          reading.current = false;
          setGot((g) => ({ total: s.total, rows: [...(g?.rows ?? []), ...s.rows] }));
        },
        () => {
          reading.current = false;
        },
      );
    },
    [stat, since],
  );
  useEffect(() => {
    more(0, (at ?? 0) + BOARD_CHUNK);
  }, [more, at]);

  useLayoutEffect(() => {
    const ol = box.current;
    if (!got || !ol || placed.current) return;
    placed.current = true;
    const li = ol.querySelector<HTMLElement>("[data-you]");
    if (li) ol.scrollTop = li.offsetTop - (ol.clientHeight - li.offsetHeight) / 2;
  }, [got]);

  const onScroll = () => {
    const ol = box.current;
    if (!ol || !got || got.rows.length >= got.total) return;
    if (ol.scrollHeight - ol.scrollTop - ol.clientHeight < 400)
      more(got.rows.length, BOARD_CHUNK * 4);
  };

  if (!got) return <p className="yl-wait">Reading the list…</p>;
  return (
    <ol className="yl-rows yl-all" ref={box} onScroll={onScroll} tabIndex={0}>
      {got.rows.map((r) => (
        <Row key={r.steamId} r={r} you={r.steamId === you} moves />
      ))}
    </ol>
  );
}

function Card({
  stat,
  ladder,
  since,
  moves,
  you,
  holding,
}: {
  stat: StandingsStat;
  ladder: Ladder;
  since: string;
  /* the gains and moves are from the reader's baseline */
  moves: boolean;
  /* You's Steam ID once You's card is read, else null */
  you: string | null;
  /* You's rows are being read: hold their place */
  holding: boolean;
}) {
  const [open, setOpen] = useState(false);
  const title = STANDINGS_TITLE[stat];
  const shown = ladder.rows.filter((r) => r !== null).length;
  return (
    <section className="ys-card" aria-label={title}>
      <h2 className="ys-h">{title}</h2>
      {open ? (
        <AllRows stat={stat} since={since} at={ladder.at} you={you} />
      ) : (
        <ol className="yl-rows">
          {ladder.rows.map((r, k) =>
            r ? (
              <Row key={r.steamId} r={r} you={r.steamId === you} moves={moves} />
            ) : (
              <li key={"gap" + String(k)} className="yl-gap" aria-hidden="true">
                &#8943;
              </li>
            ),
          )}
          {holding && <li className="yl-hold" aria-hidden="true" />}
          {you && !ladder.you && (
            <li className="yl-row yl-off">You aren&apos;t on this list yet</li>
          )}
          {!ladder.total && !you && !holding && <li className="yl-row yl-off">Nobody yet</li>}
        </ol>
      )}
      {(open || ladder.total > shown) && !holding && (
        <button
          type="button"
          className="yl-more"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? "Show less" : `Show all ${fmtN(ladder.total)}`}
        </button>
      )}
      {you && <p className="ys-chase">{chaseText(stat, ladder.chase)}</p>}
    </section>
  );
}

export function Ladders({ tops }: { tops: YouLadders }) {
  const you = useYou();
  const now = useNow();
  const fresh = now != null && youBaseline(now) === Date.parse(tops.since);
  /* who to read the cards for: You, or nobody when the server's are from another baseline */
  const key =
    you.state === "ready" || you.state === "unknown"
      ? you.id
      : you.state === "none" && now != null && !fresh
        ? NOBODY
        : null;
  const got = useRead(readLadders, key);
  const data = got?.value ?? tops;
  const id = got && key !== NOBODY ? key : null;
  const holding = you.state === "loading" ? you.claimed : key !== null && key !== NOBODY && !got;

  const who = you.state === "ready" ? you.rec.who : null;
  const read = data.readAt && now != null ? relTime(new Date(data.readAt), now) : null;
  return (
    <section className="ys">
      <header className="ys-top">
        {who && <Marble who={who} still />}
        <div>
          <h1>{who ? personaOf(who) : "Where you stand"}</h1>
          <p className="ys-line">
            {who
              ? "Where you stand on the Daily Report's four lists"
              : "The Daily Report's four lists"}
            {read && <> &middot; read {read}</>}
            {you.state === "none" && (
              <>
                {" "}
                &middot; <a href={signInHref(youHref())}>Sign in with Steam</a> to see your row
              </>
            )}
          </p>
          {(got !== null || fresh) && (
            <p className="ys-line">
              Gains and places since {sinceText(data.since)}, as the latest Daily Report counts them
            </p>
          )}
        </div>
      </header>
      <div className="ys-cards">
        {STANDINGS_STATS.map((stat) => (
          <Card
            key={stat}
            stat={stat}
            ladder={data.lists[stat]}
            since={data.since}
            moves={got !== null || fresh}
            you={id}
            holding={holding}
          />
        ))}
      </div>
    </section>
  );
}
