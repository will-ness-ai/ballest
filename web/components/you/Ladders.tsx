"use client";
// The four ladder cards on /you (lib/ladder.ts). The page arrives with each list's top 3;
// once the browser knows You, it reads You's cards from GET /api/standings?ladders, which adds
// the players around You and the line under each card. Gains and moves count from the /you
// baseline by the reader's clock, so the server's are shown only when its baseline is that
// one, and otherwise the cards are read again. "Show all" opens the whole list in the card,
// read in slices from GET /api/standings?list=: first the one around You, scrolled to You,
// then more above and below as it scrolls.
// Signed out (spec #221), the top 3s stay open, a strip on top signs in, and in each card the
// row where You would be is the sign-in, both back to /you. Until the browser can tell
// whether anyone is signed in (the server's page, and hydration), the strip and those rows
// are drawn unseen and out of reach, so a signed-out visitor's page doesn't jump when they
// show and a signed-in one never sees them.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { SteamMark } from "../SteamMark";
import { useNow } from "../../hooks/client";
import { useYou, type You } from "../../hooks/me";
import { readOnce, useReadOutcome } from "../../hooks/read";
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
import type { Who } from "../../lib/player";
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

/* the rows "Show all" reads at a time */
const SLICE = BOARD_CHUNK * 2;
/* how near an end of the read rows a scroll reads the next slice past it */
const EDGE_PX = 400;

/* The whole list, opened in the card. It reads the slice around You first and opens on You
   in the middle, then a slice at a time above or below as it scrolls near either end. Rows
   read above go in without moving the rows in view. */
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
  /* rows from..from + rows.length of the list's total */
  const [got, setGot] = useState<{ total: number; from: number; rows: Array<LadderRow> } | null>(
    null,
  );
  const reading = useRef(false);
  const box = useRef<HTMLOListElement>(null);
  /* what the next render scrolls to: You's row, or (rows read above) the same distance from
     the bottom as before them */
  const keep = useRef<"you" | { fromBottom: number } | null>("you");
  /* the first slice's read failed: 0, 1, ... counts the tries, so another try reads again */
  const [tries, setTries] = useState({ n: 0, failed: false });

  useEffect(() => {
    let live = true;
    const from = Math.max(0, (at ?? 0) - SLICE / 2);
    readSlice(stat, since, from, SLICE).then(
      (s) => {
        if (live) setGot({ total: s.total, from, rows: s.rows });
      },
      () => {
        if (live) setTries((t) => ({ ...t, failed: true }));
      },
    );
    return () => {
      live = false;
    };
  }, [stat, since, at, tries.n]);

  useLayoutEffect(() => {
    const ol = box.current;
    const k = keep.current;
    if (!got || !ol || !k) return;
    keep.current = null;
    if (k === "you") {
      const li = ol.querySelector<HTMLElement>("[data-you]");
      if (li) ol.scrollTop = li.offsetTop - (ol.clientHeight - li.offsetHeight) / 2;
    } else ol.scrollTop = ol.scrollHeight - k.fromBottom;
  }, [got]);

  const read = (from: number, count: number, above: boolean) => {
    reading.current = true;
    readSlice(stat, since, from, count).then(
      (s) => {
        reading.current = false;
        const ol = box.current;
        if (above && ol) keep.current = { fromBottom: ol.scrollHeight - ol.scrollTop };
        setGot((g) =>
          g === null
            ? g
            : above
              ? { total: s.total, from, rows: [...s.rows, ...g.rows] }
              : { total: s.total, from: g.from, rows: [...g.rows, ...s.rows] },
        );
      },
      () => {
        reading.current = false;
      },
    );
  };

  const onScroll = () => {
    const ol = box.current;
    if (!ol || !got || reading.current) return;
    const end = got.from + got.rows.length;
    if (end < got.total && ol.scrollHeight - ol.scrollTop - ol.clientHeight < EDGE_PX)
      read(end, SLICE, false);
    else if (got.from > 0 && ol.scrollTop < EDGE_PX) {
      const from = Math.max(0, got.from - SLICE);
      read(from, got.from - from, true);
    }
  };

  if (!got)
    return (
      <ol className="yl-rows yl-all" aria-busy={!tries.failed}>
        {tries.failed ? (
          <Failed
            retry={() => {
              setTries((t) => ({ n: t.n + 1, failed: false }));
            }}
          />
        ) : (
          <Holder rows={8} />
        )}
      </ol>
    );
  return (
    <ol className="yl-rows yl-all" ref={box} onScroll={onScroll} tabIndex={0}>
      {got.rows.map((r) => (
        <Row key={r.steamId} r={r} you={r.steamId === you} moves />
      ))}
    </ol>
  );
}

/* rows as grey bars while they are read, as the site's other lists show them; `you` marks
   the one that will be You's, and `gap` leaves room for the gap above them */
function Holder({ rows, you, gap }: { rows: number; you?: number; gap?: boolean }) {
  return (
    <li className="yl-hold" data-gap={gap ? true : undefined} aria-hidden="true">
      {Array.from({ length: rows }, (_, k) => (
        <span key={k} data-you={k === you || undefined} />
      ))}
    </li>
  );
}

/* in place of rows whose read failed */
function Failed({ retry }: { retry: () => void }) {
  return (
    <li className="yl-row yl-off">
      Couldn&apos;t read your rows.{" "}
      <button type="button" className="yl-again" onClick={retry}>
        Try again
      </button>
    </li>
  );
}

/* what a card's rows end with for nobody signed in: the sign-in, seen ("out") or holding its
   place ("unsure") */
type SignIn = "out" | "unsure" | null;

/* who the page is for, worked out once from the sign-in */
interface View {
  /* whose cards to read: You's Steam ID, NOBODY for the top 3s again, or null for none */
  key: string | null;
  /* someone is signed in: You's rows hold their place until they are read */
  claimed: boolean;
  signIn: SignIn;
  /* You, once the player record is read */
  who: Who | null;
}

/* `stale`: the server's top 3s are from another baseline than the reader's */
function viewOf(you: You, stale: boolean): View {
  switch (you.state) {
    case "ready":
      return { key: you.id, claimed: true, signIn: null, who: you.rec.who };
    case "unknown":
      return { key: you.id, claimed: true, signIn: null, who: null };
    case "none":
      return { key: stale ? NOBODY : null, claimed: false, signIn: "out", who: null };
    case "loading":
      return {
        /* You's cards need only the Steam ID, so they are read beside the record */
        key: you.id ?? null,
        claimed: you.claimed,
        signIn: you.claimed ? null : "unsure",
        who: null,
      };
  }
}

/* the props that keep a part of the page unseen and out of reach while it holds its place */
const held = (unsure: boolean) =>
  unsure ? ({ "data-wait": true, "aria-hidden": true, inert: true } as const) : {};

/* the row where You would be, as the way to sign in */
function SignInRow({ signIn }: { signIn: "out" | "unsure" }) {
  return (
    <li className="yl-sign" {...held(signIn === "unsure")}>
      <a href={signInHref(youHref())}>Sign in with Steam to see your row</a>
    </li>
  );
}

/* on top of the cards, signed out */
function SignInStrip({ unsure }: { unsure: boolean }) {
  return (
    <div className="ys-in" {...held(unsure)}>
      <span className="ys-in-mark">
        <SteamMark />
      </span>
      <p>
        <b>Where do you stand?</b> Sign in with Steam and your row shows on every list.
      </p>
      <a className="ys-go" href={signInHref(youHref())}>
        Sign in
      </a>
    </div>
  );
}

function Card({
  stat,
  ladder,
  since,
  moves,
  you,
  holding,
  failed,
  signIn,
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
  /* You's rows couldn't be read: try again */
  failed: (() => void) | null;
  signIn: SignIn;
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
          {holding && (failed ? <Failed retry={failed} /> : <Holder rows={4} you={2} gap />)}
          {signIn && ladder.total > shown && (
            <li className="yl-gap" aria-hidden="true">
              &#8943;
            </li>
          )}
          {signIn && <SignInRow signIn={signIn} />}
          {you && !ladder.you && (
            <li className="yl-row yl-off">You aren&apos;t on this list yet</li>
          )}
          {!ladder.total && !you && !holding && !signIn && (
            <li className="yl-row yl-off">Nobody yet</li>
          )}
        </ol>
      )}
      {(open || ladder.total > shown) && (
        <button
          type="button"
          className="yl-more"
          /* there from the first draw, so it doesn't blink out while You's rows are read */
          disabled={holding}
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

/* Each try draws the page afresh, and a fresh draw reads again what failed (hooks/read.ts) */
export function Ladders({ tops }: { tops: YouLadders }) {
  const [tries, setTries] = useState(0);
  return (
    <Page
      key={tries}
      tops={tops}
      retry={() => {
        setTries((n) => n + 1);
      }}
    />
  );
}

function Page({ tops, retry }: { tops: YouLadders; retry: () => void }) {
  const now = useNow();
  const fresh = now != null && youBaseline(now) === Date.parse(tops.since);
  const { key, claimed, signIn, who } = viewOf(useYou(), now != null && !fresh);
  const outcome = useReadOutcome(readLadders, key);
  const got = outcome && "value" in outcome ? outcome : null;
  const data = got?.value ?? tops;
  /* You's Steam ID once You's cards are read */
  const id = got && claimed ? key : null;
  const holding = claimed && !got;

  /* the gains and moves shown are from the reader's baseline */
  const moves = got !== null || fresh;

  const read = data.readAt && now != null ? relTime(new Date(data.readAt), now) : null;
  return (
    <section className="ys">
      <header className="ys-top">
        {who ? (
          <Marble who={who} still />
        ) : (
          claimed && <span className="marble ys-hold" aria-hidden="true" />
        )}
        <div>
          <h1>
            {who ? (
              personaOf(who)
            ) : claimed ? (
              <>
                <span className="ys-hold" aria-hidden="true" />
                <span className="yl-sr">Where you stand</span>
              </>
            ) : (
              "Where you stand"
            )}
          </h1>
          <p className="ys-line">
            {claimed
              ? "Where you stand on the Daily Report's four lists"
              : "The Daily Report's four lists"}
            {read && <> &middot; read {read}</>}
          </p>
          {/* held, unseen, until the gains are from the reader's baseline, so the cards
              don't move down when it shows */}
          <p className="ys-line" {...held(!moves)}>
            Gains and places since {sinceText(data.since)}, as the latest Daily Report counts them
          </p>
        </div>
      </header>
      {signIn && <SignInStrip unsure={signIn === "unsure"} />}
      <div className="ys-cards">
        {STANDINGS_STATS.map((stat) => (
          <Card
            key={stat}
            stat={stat}
            ladder={data.lists[stat]}
            since={data.since}
            moves={moves}
            you={id}
            holding={holding}
            failed={outcome && "failed" in outcome ? retry : null}
            signIn={signIn}
          />
        ))}
      </div>
    </section>
  );
}
