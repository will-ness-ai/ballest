"use client";
// A board's list: the bar over it (where the board is, how many it ranks, the sort switch
// and the search), the history card and plates the server drew, then the rows. The list starts
// with what the server rendered and grows as the reader scrolls, reading further pages from
// /api/board/<name>; a search reads its matches the same way. A board sorted by podiums
// holds its few players whole, so it pages and searches them here.
//
// Unfiltered, the top three are up on the plates and the list starts at 4th. A board with
// fewer than three has no plates, so its rows stay in the list: plenty of Maps have one or
// two.
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { QMark } from "./PointsDialog";
import { Marble } from "../Marble";
import { MedalCounts } from "../MedalCounts";
import { PlayerLink } from "../PlayerLink";
import type { BoardPage, BoardRow } from "../../lib/rows";
import { useDebouncedFetch } from "../../hooks/client";
import { podiumTotal, type Medals, type PodiumRow } from "../../lib/podiums";
import { BOARD_CHUNK, fmtN, fmtTime, hueFor, ord, personaOf, plural } from "../../lib/rules";

interface Common {
  name: string;
  /* an Overall board, scored in points (isPoints) */
  points: boolean;
  /* the meta line's lead: the season, or for a Map who made it */
  where: string;
  /* how many the board ranks */
  count: number;
  /* the sort switch, the history card and the plates, drawn on the server */
  sortsw?: React.ReactNode;
  /* a Track's or a Map's record history (HistoryCard), over the plates */
  history?: React.ReactNode;
  leaders?: React.ReactNode;
}

export type BoardBodyProps = Common &
  (
    | {
        order: "score";
        /* the rows under the plates the server rendered */
        initial: Array<BoardRow>;
        /* the leader's score, which every row's gap is to */
        lead: number | null;
        /* each podium player's counts, when the board has a tally */
        pods: Record<string, Medals> | null;
        /* a player to find and mark, with their rank */
        focus: { id: string; rank: number } | null;
      }
    | { order: "podiums"; players: Array<PodiumRow>; tracks: number; group: string }
  );

const NOBODY = (
  <div className="empty">
    <b>Nobody here by that name.</b> Names come from Steam personas, so try a shorter fragment, or
    paste a Steam ID.
  </div>
);
const NO_RUNS = (
  <div className="empty">
    <b>No runs on this board yet.</b> Nobody has set a time here, or the board has only just been
    added.
  </div>
);

/* the search box matches a persona fragment or a Steam ID, on a board and its podium sort alike */
const matches = (r: { steamId: string; persona?: string | null }, q: string) =>
  personaOf(r).toLowerCase().includes(q) || r.steamId.includes(q);

/* memoised: the list only ever grows, so a new step draws only its own rows */
const ScoreRow = memo(function ScoreRow({
  r,
  lead,
  points,
  pods,
  focus,
}: {
  r: BoardRow;
  lead: number;
  points: boolean;
  pods: Record<string, Medals> | null;
  focus: boolean;
}) {
  const gap = points ? lead - r.score : r.score - lead;
  const prev = r.ahead;
  const step = prev == null ? 0 : points ? prev - r.score : r.score - prev;
  const g = points ? fmtN(gap) + " pts" : "+" + fmtTime(gap);
  const st = points ? fmtN(step) + " pts" : "+" + fmtTime(step);
  const up = ord(r.rank - 1);
  /* a composite row says where its total came from: "S1 260,000 · S2 188,560". The
     narrow line has no room for that and both gaps, so there the breakdown takes the
     place of the gap to the leader. */
  const parts = r.seasons
    ? " · " +
      Object.entries(r.seasons)
        .map(([season, n]) => season.replace(/^Season\s*/i, "S") + " " + fmtN(n))
        .join(" · ")
    : "";
  const p = pods ? pods[r.steamId] : undefined;
  return (
    <div
      className={focus ? "row focus" : "row"}
      style={{ "--h": hueFor(r.steamId) } as React.CSSProperties}
      data-m={r.rank <= 3 ? r.rank : 0}
      data-id={r.steamId}
    >
      <span className="c-rank">{r.rank}</span>
      <Marble who={r} />
      <span className="c-text">
        <span className="nm">
          <PlayerLink id={r.steamId} text={personaOf(r)} />
        </span>
        {r.rank === 1 ? (
          <>
            <span className="sub sub-d">Leads the board{parts}</span>
            <span className="sub sub-m">Leads the board{parts}</span>
          </>
        ) : (
          <>
            <span className="sub sub-d">
              <em>{g}</em> behind · {st} to {up}
              {parts}
            </span>{" "}
            <span className="sub sub-m">
              <em>{st}</em> to {up}
              {parts || " · " + g + " back"}
            </span>
          </>
        )}
      </span>
      {pods && <span className="c-pods">{p ? <MedalCounts p={p} /> : null}</span>}
      <span className="c-score">
        <span>{points ? fmtN(r.score) : fmtTime(r.score)}</span>
        <i className="pill"></i>
      </span>
    </div>
  );
});

/* a row of the podium order: ranked by the tally, the total in the score column, and where
   they stand on points underneath */
const PodRow = memo(function PodRow({ p }: { p: PodiumRow }) {
  const sub = p.points ? (
    <>
      <em>{fmtN(p.points.score)} pts</em> · {ord(p.points.rank)} on points
    </>
  ) : (
    "not ranked on points"
  );
  return (
    <div
      className="row"
      style={{ "--h": hueFor(p.steamId) } as React.CSSProperties}
      data-m={p.rank <= 3 ? p.rank : 0}
      data-id={p.steamId}
    >
      <span className="c-rank">{p.rank}</span>
      <Marble who={p} />
      <span className="c-text">
        <span className="nm">
          <PlayerLink id={p.steamId} text={personaOf(p)} />
        </span>
        <span className="sub sub-d">{sub}</span>
        <span className="sub sub-m">{sub}</span>
      </span>
      <span className="c-pods">
        <MedalCounts p={p} />
      </span>
      <span className="c-score">
        <span>{podiumTotal(p)}</span>
        <i className="pill"></i>
      </span>
    </div>
  );
});

/* calls `more` whenever the end of the page comes within reach: on scroll, on resize, and
   after each render while the page is still too short to scroll */
function useScrollMore(more: () => void, done: boolean, rendered: number) {
  useEffect(() => {
    if (done) return;
    const near = () => {
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 900) more();
    };
    /* keep appending until the page actually overflows, so there is always something
       to scroll towards, and catch up once rows the reader scrolled towards arrive */
    if (document.documentElement.scrollHeight <= innerHeight + 800) more();
    else near();
    addEventListener("scroll", near, { passive: true });
    addEventListener("resize", near);
    return () => {
      removeEventListener("scroll", near);
      removeEventListener("resize", near);
    };
  }, [more, done, rendered]);
}

export function BoardBody(props: BoardBodyProps) {
  return props.order === "score" ? <ScoreList {...props} /> : <PodiumList {...props} />;
}

/* everything around the rows: the bar with the meta line and the search, then the history
   card and plates, and the meta line again (it shows under the plates on a phone) */
function Frame({
  props,
  meta,
  query,
  setQuery,
  children,
}: {
  props: Common;
  meta: string;
  query: string;
  setQuery: (q: string) => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="boardbar">
        <div className="boardtitle">
          <p className="bmeta" id="bmetaD">
            {meta}
          </p>
        </div>
        {props.sortsw}
        <div className="search">
          <input
            id="q"
            type="search"
            placeholder="Find a player"
            aria-label="Find a player"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </div>
      </div>
      {props.history}
      {props.leaders ?? <div className="leaders" id="leaders" hidden></div>}
      <p className="bmeta" id="bmetaM">
        {meta}
      </p>
      {children}
    </>
  );
}

function Head({ pods, score, qmark }: { pods: boolean; score: string; qmark: boolean }) {
  return (
    <div className="head">
      <span>#</span>
      <span></span>
      <span>Player</span>
      {pods && <span className="c-pods">Podiums</span>}
      <span className="c-score">
        {score}
        {qmark && <QMark />}
      </span>
    </div>
  );
}

interface List {
  q: string;
  rows: Array<BoardRow>;
  ahead: Array<BoardRow>;
  total: number;
}

function ScoreList(props: Common & Extract<BoardBodyProps, { order: "score" }>) {
  const { name, points, where, count, initial, lead, pods, focus } = props;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  /* unfiltered, the list starts under the plates */
  const base = count >= 3 ? 3 : 0;
  /* `rows` are on screen and `ahead` read but not yet shown: the list reads four steps at a
     time and shows one per scroll step, so a fast scroll rarely waits on the network */
  const [found, setFound] = useState<List>({
    q: "",
    rows: initial,
    ahead: [],
    total: count - base,
  });
  const reading = useRef(false);

  const read = useCallback(
    async (forQ: string, from: number, n: number) => {
      const qs = new URLSearchParams({ from: String(from), count: String(n) });
      if (forQ) qs.set("q", forQ);
      const res = await fetch(`/api/board/${encodeURIComponent(name)}?${qs.toString()}`);
      if (!res.ok) throw new Error(`board ${name}: ${String(res.status)}`);
      return (await res.json()) as BoardPage;
    },
    [name],
  );

  /* a new search starts its list over with its first page; clearing it goes back to the
     board */
  const firstPage = useCallback((forQ: string) => read(forQ, 0, BOARD_CHUNK), [read]);
  const search = useDebouncedFetch(q, firstPage).last;
  const [took, setTook] = useState(search);
  if (search !== took) {
    setTook(search);
    setFound((f) =>
      search
        ? { q: search.key, rows: search.data.rows, ahead: [], total: search.data.total }
        : f.q
          ? { q: "", rows: initial, ahead: [], total: count - base }
          : f,
    );
  }

  const showing = found.q === q ? found : null;
  /* read the next pages into `ahead`, once it runs low */
  const refill = useCallback(
    (l: List) => {
      const have = l.rows.length + l.ahead.length;
      if (reading.current || l.ahead.length >= BOARD_CHUNK * 2 || have >= l.total) return;
      reading.current = true;
      void read(l.q, (l.q ? 0 : base) + have, BOARD_CHUNK * 4)
        .then((page) => {
          setFound((f) =>
            f.q === l.q && f.rows.length + f.ahead.length === have
              ? { ...f, ahead: [...f.ahead, ...page.rows] }
              : f,
          );
        })
        .finally(() => {
          reading.current = false;
        });
    },
    [base, read],
  );
  const more = useCallback(() => {
    if (!showing) return;
    if (showing.ahead.length)
      setFound((f) =>
        f === showing
          ? {
              ...f,
              rows: [...f.rows, ...f.ahead.slice(0, BOARD_CHUNK)],
              ahead: f.ahead.slice(BOARD_CHUNK),
            }
          : f,
      );
    refill(showing);
  }, [showing, refill]);
  const rows = showing?.rows ?? found.rows;
  const total = showing?.total ?? found.total;
  useScrollMore(more, !showing || rows.length >= total, rows.length + (showing?.ahead.length ?? 0));

  /* a link to a player's row: read down to it, then bring it into view */
  const sought = useRef(false);
  useEffect(() => {
    if (!focus || sought.current) return;
    const loaded = base + found.rows.length;
    if (focus.rank > loaded && !found.q) {
      if (reading.current) return;
      reading.current = true;
      const n = Math.ceil((focus.rank - loaded) / BOARD_CHUNK) * BOARD_CHUNK - found.ahead.length;
      void read("", loaded + found.ahead.length, Math.max(n, 1))
        .then((page) => {
          setFound((f) =>
            f.q ? f : { ...f, rows: [...f.rows, ...f.ahead, ...page.rows], ahead: [] },
          );
        })
        .finally(() => {
          reading.current = false;
        });
      return;
    }
    sought.current = true;
    document.querySelector(".focus")?.scrollIntoView({ block: "center" });
  }, [focus, found, base, read]);

  const noun = count === 1 ? (points ? "player" : "run") : points ? "players" : "runs";
  const meta = showing?.q
    ? `${where} · ${fmtN(total)} of ${fmtN(count)} ${noun} match`
    : `${where} · ${fmtN(count)} ${noun} · showing ${fmtN(rows.length)}`;
  return (
    <Frame props={props} meta={meta} query={query} setQuery={setQuery}>
      {rows.length ? (
        <div className={pods ? "board pods" : "board"} id="board">
          <Head pods={!!pods} score={points ? "Points" : "Time"} qmark={points} />
          {rows.map((r) => (
            <ScoreRow
              key={r.steamId}
              r={r}
              lead={lead ?? r.score}
              points={points}
              pods={pods}
              focus={focus?.id === r.steamId}
            />
          ))}
          {rows.length < total && (
            <div className="more" id="more">
              Loading more
            </div>
          )}
        </div>
      ) : (
        <div className={pods ? "board pods" : "board"} id="board">
          {q ? NOBODY : NO_RUNS}
        </div>
      )}
    </Frame>
  );
}

function PodiumList(props: Common & Extract<BoardBodyProps, { order: "podiums" }>) {
  const { players, tracks, group } = props;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;
  const [limit, setLimit] = useState(BOARD_CHUNK);
  const podium = players.length >= 3;
  const visible = filtering
    ? players.filter((p) => matches(p, q))
    : players.filter((_, i) => !podium || i >= 3);
  const shown = visible.slice(0, limit);
  const more = useCallback(() => {
    setLimit((n) => n + BOARD_CHUNK);
  }, []);
  useScrollMore(more, shown.length >= visible.length, shown.length);
  const n = players.length;
  const meta = filtering
    ? `${group} · ${fmtN(visible.length)} of ${plural(n, "player", "players")} match`
    : `${group} · ${plural(n, "player", "players")} on a podium · ${plural(tracks, "track", "tracks")}`;
  return (
    <Frame props={props} meta={meta} query={query} setQuery={setQuery}>
      <div className="board pods" id="board">
        {visible.length ? (
          <>
            <Head pods score="Total" qmark={false} />
            {shown.map((p) => (
              <PodRow key={p.steamId} p={p} />
            ))}
            {shown.length < visible.length && (
              <div className="more" id="more">
                Loading more
              </div>
            )}
          </>
        ) : q ? (
          NOBODY
        ) : (
          NO_RUNS
        )}
      </div>
    </Frame>
  );
}
