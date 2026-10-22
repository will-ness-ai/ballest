// Which Match the page shows. Pure: the board the API sends and what the viewer presses go in,
// the screen's state comes out, and the components draw only that.
//
// In order: your own Match if you're racing in one (the lock), else a Match you opened to watch,
// else the Map Gallery. A Match you were in stays on screen after its Result until Back.
import type { MatchView } from "../api.js";
import type { Me } from "./types.js";

/** One poll of the API: who is looking, every open Invite and live Match, and the server's clock. */
export interface Board {
  readonly me: Me;
  readonly now: number;
  readonly matches: ReadonlyArray<MatchView>;
}

/**
 * The Match on screen when it isn't on the board (it finished, or it's gone), as GET
 * /api/matches/:id answered for `id`; `closed` says why it went without a Result. Null while
 * nothing has been asked for, or the answer isn't in yet.
 */
export type Lookup = {
  readonly id: string;
  readonly match: MatchView | null;
  readonly closed: string | null;
} | null;

export interface Nav {
  /** The viewer's own Match, shown alone: the lock. Kept after its Result until Back. */
  readonly mine: string | null;
  /** A Match the viewer opened to watch. */
  readonly watching: string | null;
  /** The Match on screen: `mine`, else `watching`, as last seen. */
  readonly shown: MatchView | null;
  /** The New Match form is open in the Gallery. */
  readonly composing: boolean;
  /** The viewer's Invite that was cancelled because no Map fitted. */
  readonly noMap: MatchView | null;
  /** The viewer's Match went live on this page at `at` (this device's clock): Go!, and the Map slides in. */
  readonly go: { readonly matchId: string; readonly at: number } | null;
}

export const NO_NAV: Nav = {
  mine: null,
  watching: null,
  shown: null,
  composing: false,
  noMap: null,
  go: null,
};

export type NavEvent =
  /** A fresh poll; `at` is this device's clock. */
  | { readonly kind: "board"; readonly board: Board; readonly lookup: Lookup; readonly at: number }
  | { readonly kind: "watch"; readonly match: MatchView }
  | { readonly kind: "back" }
  | { readonly kind: "compose"; readonly open: boolean }
  /** The viewer opened, joined, accepted or started `id`; `match` is how it stands now, if the API said. */
  | {
      readonly kind: "entered";
      readonly id: string;
      readonly match: MatchView | null;
      readonly at: number;
    }
  /** The viewer left or cancelled `id`; a live Match they left is watched. */
  | { readonly kind: "left"; readonly id: string; readonly watch: boolean }
  | { readonly kind: "noMap"; readonly match: MatchView }
  /** The Map was opened in the Workshop: Go! has done its job. */
  | { readonly kind: "workshop" };

/** One of the Match's Players (who may have left it since). */
export const isRacer = (m: MatchView, discordId: string) =>
  m.players.some((p) => p.discordId === discordId);

const wentLive = (before: MatchView | null, after: MatchView | null) =>
  before !== null &&
  after !== null &&
  before.matchId === after.matchId &&
  before.state === "invite" &&
  after.state === "live";

const onBoard = (nav: Nav, { me, matches }: Board, lookup: Lookup, at: number): Nav => {
  let { mine, watching, composing, noMap, go } = nav;
  // The lock: a Match the viewer is racing in. A Challenge that only names them stays in the Gallery.
  const current = matches.find((m) => m.matchId === me.matchId);
  if (current !== undefined && isRacer(current, me.discordId)) {
    mine = current.matchId;
    watching = null;
    composing = false;
  }
  const id = mine ?? watching;
  if (id === null) return { ...nav, mine, watching, composing, shown: null };
  const listed = matches.find((m) => m.matchId === id);
  // Off the board and not looked up yet: change nothing until we know where it went.
  if (listed === undefined && lookup?.id !== id) return { ...nav, mine, watching, composing };
  let shown = listed ?? lookup?.match ?? null;
  // Your Invite went because no Map fitted: say so, whoever pressed Start.
  if (mine !== null && shown === null && lookup?.closed === "noEligibleMap")
    noMap = nav.shown?.matchId === mine ? nav.shown : noMap;
  // No longer in it (left from the channel, or it ended): a live one is watched, a Result stays, an Invite goes.
  if (mine !== null && me.matchId !== mine && shown?.state !== "finished") {
    if (shown?.state === "live") watching = mine;
    else shown = null;
    mine = null;
  }
  if (shown === null) watching = null;
  if (mine !== null && shown?.matchId === mine && wentLive(nav.shown, shown))
    go = { matchId: mine, at };
  return { mine, watching, composing, noMap, go, shown };
};

export const navigate = (nav: Nav, event: NavEvent): Nav => {
  switch (event.kind) {
    case "board":
      return onBoard(nav, event.board, event.lookup, event.at);
    case "watch":
      return { ...nav, watching: event.match.matchId, shown: event.match, composing: false };
    case "back":
      return { ...nav, mine: null, watching: null, shown: null, noMap: null };
    case "compose":
      return { ...nav, composing: event.open };
    case "entered":
      return {
        ...nav,
        mine: event.id,
        watching: null,
        composing: false,
        shown: event.match ?? (nav.shown?.matchId === event.id ? nav.shown : null),
        go: event.match?.state === "live" ? { matchId: event.id, at: event.at } : nav.go,
      };
    case "left":
      return {
        ...nav,
        mine: null,
        watching: event.watch ? event.id : null,
        shown: event.watch ? nav.shown : null,
      };
    case "noMap":
      return { ...nav, noMap: event.match, mine: null, shown: null };
    case "workshop":
      return { ...nav, go: null };
  }
};
