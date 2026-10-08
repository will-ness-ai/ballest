"use client";
// The Players table: the search, the scope tabs, the note, then every player ranked by the
// column the reader sorts on (lib/players.ts), drawn a step at a time as the table scrolls.
// On a phone the table scrolls inside its own box, from 820px the page itself does. Your
// own row ("This is me"), while it is out of view, is pinned to the foot as a card that
// says how far the next rank and the top 10 are; tapping it brings the row into view.
import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import type { Standings } from "../../lib/rows";
import { useDebounced } from "../../hooks/client";
import { useMe } from "../../hooks/me";
import {
  PL_SCOPE_LABELS,
  plCol,
  plCols,
  plPlayer,
  plRank,
  plVal,
  type PlRanked,
} from "../../lib/players";
import { fmtN, ord, personaOf, plural } from "../../lib/rules";
import { playersHref, type PlScope, type PlSort } from "../../lib/routes";

/* rows the table adds per step */
const PL_CHUNK = 50;

/* the search outlives a switch of scope or sort, as it did on the single-page site */
let keptQuery = "";

const NOBODY = (
  <div className="empty">
    <b>Nobody here by that name.</b> Names come from Steam personas, so try a shorter fragment, or
    paste a Steam ID.
  </div>
);

/* what of the table is on screen: the box's own view on a phone, where it scrolls inside
   itself, or the window's from 820px, where the page scrolls */
const inBox = (wrap: HTMLElement) => getComputedStyle(wrap).overflowY !== "visible";
function viewOf(wrap: HTMLElement) {
  const b = wrap.getBoundingClientRect();
  return { top: Math.max(b.top, 0), bottom: Math.min(b.bottom, innerHeight) };
}
/* how far below the view the drawn rows run on */
const aheadOf = (wrap: HTMLElement) =>
  inBox(wrap)
    ? wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight
    : wrap.getBoundingClientRect().bottom - innerHeight;

const Cell = ({ n }: { n: number }) => (n ? <>{fmtN(n)}</> : <span className="z">&ndash;</span>);

const Row = memo(function Row({
  r,
  scope,
  sort,
  me,
  focus,
}: {
  r: PlRanked;
  scope: PlScope;
  sort: PlSort;
  me: boolean;
  focus: boolean;
}) {
  const p = r.p;
  return (
    <tr
      data-m={r.rank <= 3 ? r.rank : 0}
      data-id={p.steamId}
      className={me ? (focus ? "me focus" : "me") : undefined}
    >
      <td className="pr">{r.rank}</td>
      <td className="pn">
        <span className="who">
          <Marble who={p} />
          <span className="nm">
            <PlayerLink
              id={p.steamId}
              text={personaOf(p)}
              tab={scope === "all" ? undefined : scope}
            />
          </span>
          {me && <span className="youtag">You</span>}
        </span>
      </td>
      {plCols(scope).map(([k]) => (
        <td key={k} className={k === sort ? "on" : undefined}>
          <Cell n={plVal(p, k, scope)} />
        </td>
      ))}
      {scope === "all" && (
        <>
          <td className="split">
            <Cell n={p.c.wr} />
          </td>
          <td>
            <Cell n={p.w.wr} />
          </td>
        </>
      )}
    </tr>
  );
});

function Head({ scope, sort }: { scope: PlScope; sort: PlSort }) {
  return (
    <tr>
      <th className="pr" scope="col">
        #
      </th>
      <th className="pn" scope="col">
        Player
      </th>
      {plCols(scope).map(([k, label, noun]) => (
        <th
          key={k}
          scope="col"
          className={k === sort ? "on" : undefined}
          aria-sort={k === sort ? "descending" : undefined}
        >
          <Link href={playersHref(scope, k)} scroll={false} title={`Sort by ${noun[1]}`}>
            {label}
          </Link>
        </th>
      ))}
      {scope === "all" && (
        <>
          <th className="split" scope="col">
            Circuit WRs
          </th>
          <th scope="col">Workshop WRs</th>
        </>
      )}
    </tr>
  );
}

/* your own row as a card: where you stand, and what the next rank and the top 10 take */
function Pin({
  all,
  i,
  sort,
  shown,
  onJump,
  pinRef,
}: {
  all: ReadonlyArray<PlRanked>;
  i: number;
  sort: PlSort;
  shown: boolean;
  onJump: () => void;
  pinRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const r = all[i],
    noun = plCol(sort)[2];
  let up: PlRanked | null = null;
  for (let j = i - 1; j >= 0 && !up; j--) if (all[j].v > r.v) up = all[j];
  return (
    <button
      type="button"
      className="plpin"
      id="plpin"
      hidden={!shown}
      aria-label="Go to your row"
      ref={pinRef}
      onClick={onJump}
    >
      <Marble who={{ steamId: r.p.steamId }} />
      <span className="me-t">
        <b>
          {personaOf(r.p)}
          <span className="youtag">You</span>
        </b>
        <small>
          {ord(r.rank)} &middot; {fmtN(r.v)} {r.v === 1 ? noun[0] : noun[1]}
        </small>
      </span>
      <span className="gaps">
        {up ? (
          <span>
            <b>+{fmtN(up.v - r.v)}</b> to {ord(up.rank)}
          </span>
        ) : (
          <span>
            <b>{all[i + 1]?.v === r.v ? "Shares" : "Holds"}</b> the lead
          </span>
        )}
        {r.rank <= 10 ? (
          <span>
            <b>In</b> the top 10
          </span>
        ) : (
          <span>
            <b>+{fmtN(all[9].v - r.v)}</b> to the top 10
          </span>
        )}
      </span>
    </button>
  );
}

export function PlayersTable({
  standings,
  scope,
  sort,
}: {
  standings: Standings;
  scope: PlScope;
  sort: PlSort;
}) {
  const me = useMe();
  const [text, setText] = useState(keptQuery);
  const query = useDebounced(text);
  useEffect(() => {
    keptQuery = query;
  }, [query]);

  const players = useMemo(() => standings.players.map(plPlayer), [standings]);
  const all = useMemo(() => plRank(players, scope, sort), [players, scope, sort]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      q
        ? all.filter((r) => personaOf(r.p).toLowerCase().includes(q) || r.p.steamId.includes(q))
        : all,
    [all, q],
  );
  const [shown, setShown] = useState({ rows, n: PL_CHUNK });
  /* a new list starts again from its first step, unmarked */
  const n = shown.rows === rows ? shown.n : PL_CHUNK;
  const [focus, setFocus] = useState<ReadonlyArray<PlRanked> | null>(null);
  const jumped = focus === rows;
  const [pinShown, setPinShown] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLButtonElement>(null);
  const jumpTo = useRef(false);

  /* a new list (a search, or the table opened at another scope or sort) shows from its top */
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    wrap.scrollTop = 0;
    if (!inBox(wrap) && wrap.getBoundingClientRect().top < 0)
      scrollTo({ top: wrap.getBoundingClientRect().top + scrollY - 12 });
  }, [rows]);

  const meAt = q || !me ? -1 : all.findIndex((r) => r.p.steamId === me);

  /* keep rows drawn a little past the view, so there is always something to scroll
     towards, then show the card while your row is out of view or not drawn yet */
  const update = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (aheadOf(wrap) < 600 && n < rows.length) {
      setShown({ rows, n: Math.min(n + PL_CHUNK, rows.length) });
      return;
    }
    const pin = pinRef.current;
    if (!pin) return;
    const tr = wrap.querySelector("tr.me"),
      head = wrap.querySelector("thead");
    let away = true;
    if (tr && head) {
      const a = tr.getBoundingClientRect(),
        v = viewOf(wrap);
      away =
        a.top >= v.bottom - (pin.hidden ? 0 : pin.offsetHeight) ||
        a.bottom <= v.top + head.offsetHeight;
    }
    setPinShown(away);
  }, [n, rows]);

  useLayoutEffect(() => {
    if (jumpTo.current) {
      jumpTo.current = false;
      const wrap = wrapRef.current,
        tr = wrap?.querySelector<HTMLElement>("tr.me");
      if (wrap && tr) {
        if (inBox(wrap)) wrap.scrollTop = tr.offsetTop - wrap.clientHeight / 2;
        else scrollTo({ top: tr.getBoundingClientRect().top + scrollY - innerHeight / 2 });
      }
    }
    update();
  }, [update, me, jumped]);

  useEffect(() => {
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, [update]);

  const jump = () => {
    if (meAt < 0) return;
    let to = n;
    while (to <= meAt && to < rows.length) to += PL_CHUNK;
    setShown({ rows, n: Math.min(to, rows.length) });
    setFocus(rows);
    jumpTo.current = true;
  };

  const { tracks, maps } = standings;
  const where: Record<PlScope, string> = {
    circuit: plural(tracks, "Circuit track", "Circuit tracks"),
    workshop: plural(maps, "Workshop map", "Workshop maps"),
    all: "",
  };
  where.all = where.circuit + " and " + where.workshop;
  const note = q
    ? `${fmtN(rows.length)} of ${plural(all.length, "player", "players")} match, ranks kept`
    : `${plural(all.length, "player", "players")} with ${plCol(sort)[3]} · ${where[scope]}`;

  return (
    <>
      <div className="ws-head">
        <h1 className="ws-h1">Players</h1>
        <span className="ws-tools">
          <input
            className="ws-q"
            id="plq"
            type="search"
            placeholder="Find a player"
            aria-label="Find a player"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </span>
      </div>
      <nav className="ptabs" aria-label="Where to count">
        {PL_SCOPE_LABELS.map(([k, label]) => (
          <Link
            key={k}
            href={playersHref(k, k === "circuit" && sort === "maps" ? "wr" : sort)}
            scroll={false}
            aria-current={k === scope ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <p className="ws-note" id="plnote">
        {note}
      </p>
      <div className="plwrap" id="plwrap" ref={wrapRef} onScroll={update}>
        {!rows.length ? (
          q ? (
            NOBODY
          ) : (
            <div className="empty">
              <b>Nobody here yet.</b>
            </div>
          )
        ) : (
          <>
            <table className="plt">
              <thead>
                <Head scope={scope} sort={sort} />
              </thead>
              <tbody>
                {rows.slice(0, n).map((r) => (
                  <Row
                    key={r.p.steamId}
                    r={r}
                    scope={scope}
                    sort={sort}
                    me={r.p.steamId === me}
                    focus={jumped && r.p.steamId === me}
                  />
                ))}
              </tbody>
            </table>
            {meAt >= 0 && (
              <Pin all={all} i={meAt} sort={sort} shown={pinShown} onJump={jump} pinRef={pinRef} />
            )}
          </>
        )}
      </div>
    </>
  );
}
