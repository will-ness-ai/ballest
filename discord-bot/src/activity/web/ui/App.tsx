// The signed-in page. The board (who is looking, every open Invite and live Match) is one query
// polled every two seconds; nav.ts turns each answer and each press into what's on screen; a
// member's action is one mutation at a time, after which the board is read again.
//
// When Discord shrinks it to picture-in-picture, it shows just the standings of the Match on
// screen. Otherwise: your own Match if you're in one (the lock), else a Match you opened to
// watch, else the Map Gallery.
import type { DiscordSDK } from "@discord/embedded-app-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { DECLINE_PING, getPing, pingOffer, pingsHave, UNDO_PING } from "../../../pingWords.js";
import type { MatchView } from "../../api.js";
import { serverClock } from "../clock.js";
import { ApiError, type Acted, type Draft, messageOf } from "../client.js";
import { useBefore, usePip, usePresence, useViewport } from "../hooks.js";
import { type Board, type Lookup, NO_NAV, type Nav, type NavEvent, navigate } from "../nav.js";
import { keys, POLL_MS, useClient } from "../queries.js";
import { type Actions, ActionsProvider } from "./controls.js";
import { LeaveDialog, LinkDialog, Toast, type ToastMessage } from "./dialogs.js";
import { Gallery } from "./gallery.js";
import { GoBar, MatchScreen, MyInvite, NoMap, Picking } from "./match.js";
import { Notice } from "./notice.js";
import { Pip } from "./pip.js";

/** How long the Go! bar stays up unless its button is pressed. */
const GO_MS = 60_000;
const REVEAL_MS = 1_500;
const TOAST_MS = 6_000;
/** Wider than this, the progression graph gets its wide shape. */
const WIDE_PX = 640;

/** What a member pressed before they had to link Steam; it goes through once they have. */
type Pending =
  { readonly verb: "new" } | { readonly verb: "accept" | "join"; readonly matchId: string };

/** A member's action: what it does, and the Invite whose Map is being picked meanwhile. */
interface Job {
  readonly run: () => Promise<void>;
  readonly starting?: MatchView | null;
}

/** nav.ts's state, with the board and lookup it last saw so each new answer is taken once. */
interface Seen {
  readonly nav: Nav;
  readonly board: Board | null;
  readonly lookup: Lookup;
}

const step = (s: Seen, e: NavEvent): Seen => ({
  nav: navigate(s.nav, e),
  board: e.kind === "board" ? e.board : s.board,
  lookup: e.kind === "board" ? e.lookup : s.lookup,
});

export const App = ({
  sdk,
  demoPip,
  onNotMember,
}: {
  readonly sdk: DiscordSDK | null;
  readonly demoPip: boolean;
  /** The bot says the viewer isn't in a server Multiballs runs in. */
  readonly onNotMember: () => void;
}) => {
  const client = useClient();
  const qc = useQueryClient();
  const [seen, dispatch] = useReducer(step, { nav: NO_NAV, board: null, lookup: null });
  const nav = seen.nav;
  const [draft, setDraft] = useState<Draft>({ type: "lobby", minutes: 15, target: null });
  const [linking, setLinking] = useState<{ readonly pending: Pending | null } | null>(null);
  const [leaving, setLeaving] = useState<MatchView | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const pip = usePip(sdk, demoPip);
  const { width } = useViewport();

  const job = useMutation({
    mutationFn: async (j: Job) => {
      // A poll that left before the action would land after it with the old board.
      await qc.cancelQueries({ queryKey: keys.board });
      await j.run();
      await qc.invalidateQueries({ queryKey: keys.board });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.error === "NotMember") onNotMember();
      else setToast({ text: messageOf(e), kind: "error", buttons: [], sticky: false });
    },
  });
  const busy = job.isPending;
  const mutate = job.mutate;
  const starting = job.isPending ? (job.variables.starting ?? null) : null;

  const board = useQuery({
    queryKey: keys.board,
    queryFn: client.board,
    refetchInterval: busy ? false : POLL_MS,
  });
  const me = board.data?.me ?? null;
  const matches = board.data?.matches ?? [];

  // The Match on screen when it's no longer on the board: read on its own, until it's final.
  const id = nav.mine ?? nav.watching;
  const listed = id !== null && matches.some((m) => m.matchId === id);
  const single = useQuery({
    queryKey: keys.match(id),
    queryFn: () => client.match(id ?? ""),
    enabled: id !== null && board.data !== undefined && !listed && !busy,
    refetchInterval: (q) => (q.state.data?.match?.state === "live" ? POLL_MS : false),
  });
  // Only an answer at least as new as the board can say where the Match went.
  const lookup =
    single.data !== undefined && single.dataUpdatedAt >= board.dataUpdatedAt ? single.data : null;
  // While an action is on its way the board is from before it; its answer is taken once it lands.
  if (!busy && board.data !== undefined && (board.data !== seen.board || lookup !== seen.lookup))
    dispatch({ kind: "board", board: board.data, lookup, at: board.dataUpdatedAt });

  useEffect(() => {
    if (board.data !== undefined) serverClock.heard(board.data.now);
  }, [board.data]);
  useEffect(() => {
    if (board.error instanceof ApiError && board.error.error === "NotMember") onNotMember();
  }, [board.error, onNotMember]);

  const shown = nav.shown;
  // A live Lobby the viewer might join late: their PB on its Map, read once.
  const pbFor =
    shown?.state === "live" && shown.actions.includes("join") && me?.link != null
      ? shown.matchId
      : null;
  const pb = useQuery({
    queryKey: keys.pb(pbFor ?? ""),
    queryFn: () => client.personalBest(pbFor ?? ""),
    enabled: pbFor !== null,
    staleTime: Infinity,
  });

  const goUntil = nav.go === null ? 0 : nav.go.at + GO_MS;
  const goUp = useBefore(goUntil);
  const revealing = useBefore(nav.go === null ? 0 : nav.go.at + REVEAL_MS);
  useEffect(() => {
    if (nav.go !== null && !goUp) dispatch({ kind: "goDone" });
  }, [nav.go, goUp]);

  // Toasts go by themselves unless they wait for an answer.
  useEffect(() => {
    if (toast === null || toast.sticky) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const mine = shown !== null && nav.mine === shown.matchId && shown.state !== "finished";
  usePresence(
    sdk,
    mine ? "In a Match" : shown !== null ? "Watching a Match" : "Browsing Matches",
    mine && shown.state === "live" && shown.endsAt !== null
      ? shown.endsAt - serverClock.offset()
      : null,
  );

  const { actions, proceed } = useMemo(() => {
    const run = (j: Job | (() => Promise<void>)) => {
      if (!busy) mutate(typeof j === "function" ? { run: j } : j);
    };
    const matchById = (matchId: string) =>
      nav.shown?.matchId === matchId
        ? nav.shown
        : (qc.getQueryData<Board>(keys.board)?.matches.find((m) => m.matchId === matchId) ?? null);
    const external = (url: string) => {
      if (sdk !== null) void sdk.commands.openExternalLink({ url });
      else window.open(url, "_blank", "noopener");
    };
    const setPings = (on: boolean, undo: boolean) =>
      run(async () => {
        const r = await client.setPings(on);
        qc.setQueryData<Board>(keys.board, (b) =>
          b === undefined ? b : { ...b, me: { ...b.me, pings: r.pings } },
        );
        const role = qc.getQueryData<Board>(keys.board)?.me.pingRole ?? "";
        setToast({
          text: pingsHave(r.pings, role),
          kind: "info",
          buttons: undo
            ? [{ label: UNDO_PING, look: "", onClick: () => setPings(!r.pings, false) }]
            : [],
          sticky: false,
        });
      });
    /** The offer of the ping role after a Join or Accept: it stays until it's answered or closed. */
    const offerPings = (r: Acted) => {
      if (r.pingOffer !== true) return;
      const role = qc.getQueryData<Board>(keys.board)?.me.pingRole ?? "";
      setToast({
        text: pingOffer(role),
        kind: "info",
        buttons: [
          { label: getPing(role), look: "go", onClick: () => setPings(true, false) },
          {
            label: DECLINE_PING,
            look: "",
            onClick: () =>
              run(async () => {
                await client.declinePings();
                setToast(null);
              }),
          },
        ],
        sticky: true,
      });
    };
    /** Start a Lobby or accept a 1v1: the Map is picked meanwhile, up to about 20 seconds. */
    const startMatch = (verb: "start" | "accept", matchId: string) => {
      const m = matchById(matchId);
      run({
        starting: m,
        run: async () => {
          try {
            const r = await client.act(matchId, verb);
            offerPings(r);
            dispatch({ kind: "entered", id: matchId, match: r.match, at: Date.now() });
          } catch (e) {
            if (!(e instanceof ApiError && e.error === "NoEligibleMap" && m !== null)) throw e;
            dispatch({ kind: "noMap", match: m });
          }
        },
      });
    };
    const join = (matchId: string) =>
      run(async () => {
        const r = await client.act(matchId, "join");
        offerPings(r);
        dispatch({ kind: "entered", id: matchId, match: r.match, at: Date.now() });
      });
    /** Go ahead, now that the member is linked. */
    const proceed = (pending: Pending) => {
      if (pending.verb === "new") dispatch({ kind: "compose", open: true });
      else if (pending.verb === "accept") startMatch("accept", pending.matchId);
      else join(pending.matchId);
    };
    /** Go ahead, or ask for a Link first and go ahead after it. */
    const linked = (pending: Pending) => {
      if (qc.getQueryData<Board>(keys.board)?.me.link == null) setLinking({ pending });
      else proceed(pending);
    };
    const actions: Actions = {
      busy,
      newMatch: () => linked({ verb: "new" }),
      closeNew: () => dispatch({ kind: "compose", open: false }),
      open: (d) =>
        run(async () => {
          const { matchId } = await client.open(d);
          // Read at once, so the new Invite shows without waiting for the board.
          const { match } = await client.match(matchId);
          dispatch({ kind: "entered", id: matchId, match, at: Date.now() });
        }),
      accept: (matchId) => linked({ verb: "accept", matchId }),
      decline: (matchId) =>
        run(async () => {
          await client.act(matchId, "decline");
        }),
      join: (matchId) => linked({ verb: "join", matchId }),
      start: (matchId) => startMatch("start", matchId),
      cancel: (matchId) =>
        run(async () => {
          await client.act(matchId, "cancel");
          dispatch({ kind: "left", id: matchId, watch: false });
        }),
      leave: (m) => {
        if (m.state === "live") setLeaving(m);
        else
          run(async () => {
            await client.act(m.matchId, "leave");
            dispatch({ kind: "left", id: m.matchId, watch: false });
          });
      },
      leaveLive: (matchId) =>
        run(async () => {
          await client.act(matchId, "leave");
          setLeaving(null);
          dispatch({ kind: "left", id: matchId, watch: true });
        }),
      watch: (m) => dispatch({ kind: "watch", match: m }),
      back: () => dispatch({ kind: "back" }),
      workshop: (pfid) => {
        dispatch({ kind: "goDone" });
        external(`https://steamcommunity.com/sharedfiles/filedetails/?id=${pfid}`);
      },
      external,
      link: () => setLinking({ pending: null }),
      togglePings: () => {
        const pings = qc.getQueryData<Board>(keys.board)?.me.pings;
        if (pings != null) setPings(!pings, true);
      },
    };
    return { actions, proceed };
  }, [busy, mutate, client, qc, sdk, nav.shown]);

  const closeLink = useCallback(() => setLinking(null), []);
  const stay = useCallback(() => setLeaving(null), []);

  if (me === null) {
    if (board.isError)
      return (
        <Notice>
          <div className="err">{messageOf(board.error)}</div>
          <button className="btn go" type="button" onClick={() => void board.refetch()}>
            Try again
          </button>
        </Notice>
      );
    return (
      <Notice>
        <span className="note">Loading Matches…</span>
      </Notice>
    );
  }

  const page = (): ReactNode => {
    if (pip) return <Pip viewer={me} focus={shown} matches={matches} />;
    if (starting !== null) return <Picking m={starting} viewer={me} />;
    if (nav.noMap !== null) return <NoMap m={nav.noMap} viewer={me} />;
    if (shown !== null && nav.mine === shown.matchId) {
      if (shown.state === "invite")
        return shown.starting ? (
          <Picking m={shown} viewer={me} />
        ) : (
          <MyInvite m={shown} viewer={me} />
        );
      return (
        <>
          {shown.state === "live" && nav.go?.matchId === shown.matchId && goUp ? (
            <GoBar m={shown} offset={serverClock.offset()} />
          ) : null}
          <MatchScreen
            m={shown}
            viewer={me}
            locked
            now={board.data?.now ?? 0}
            wide={width >= WIDE_PX}
            pb={undefined}
            reveal={revealing}
          />
        </>
      );
    }
    if (shown !== null)
      return (
        <MatchScreen
          m={shown}
          viewer={me}
          locked={false}
          now={board.data?.now ?? 0}
          wide={width >= WIDE_PX}
          pb={pbFor === null ? undefined : pb.data}
          reveal={false}
        />
      );
    return (
      <Gallery
        viewer={me}
        matches={matches}
        composing={nav.composing}
        draft={draft}
        setDraft={setDraft}
      />
    );
  };

  const joining =
    linking?.pending == null || linking.pending.verb === "new"
      ? null
      : (matches.find((m) => m.matchId === (linking.pending as { matchId: string }).matchId) ??
        null);

  return (
    <ActionsProvider value={actions}>
      {page()}
      {pip || linking === null ? null : (
        <LinkDialog
          viewer={me}
          joining={joining}
          onClose={closeLink}
          onLinked={async () => {
            await qc.invalidateQueries({ queryKey: keys.board });
            const pending = linking.pending;
            setLinking(null);
            if (pending !== null) proceed(pending);
          }}
        />
      )}
      {pip || leaving === null ? null : <LeaveDialog m={leaving} onStay={stay} />}
      {pip ? null : toast !== null ? (
        <Toast t={toast} onClose={() => setToast(null)} />
      ) : board.isRefetchError ? (
        <Toast
          t={{ text: "Reconnecting to Multiballs…", kind: "info", buttons: [], sticky: false }}
          onClose={() => undefined}
        />
      ) : null}
    </ActionsProvider>
  );
};
