// The bot's API as the page calls it. Every path is relative: Discord's URL Mapping puts the page
// and the API on one origin. A 401 signs in again once and repeats the request.
import type { MatchType, Minutes } from "../../domain.js";
import type { Challengeable, LinkPreview, MatchView } from "../api.js";
import type { Board } from "./nav.js";
import type { SignedIn } from "./session.js";
import type { Me } from "./types.js";

export class ApiError extends Error {
  constructor(
    message: string,
    /** The API's tag for it: "NotMember", "NoEligibleMap", "ProfileNotFound", ... */
    readonly error: string,
    readonly status: number,
    /** For a Match that's gone: why it ended without a Result, if it did lately. */
    readonly closed: string | null = null,
  ) {
    super(message);
  }
}

export const UNREACHABLE = "Couldn't reach Multiballs. Try again in a moment.";

/** What to tell the member about a failed request. */
export const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : UNREACHABLE);

/** A Match after the member's own action on it, and whether to offer them the ping role. */
export interface Acted {
  readonly match: MatchView | null;
  readonly pingOffer?: boolean;
}

export interface Draft {
  readonly type: MatchType;
  readonly minutes: Minutes;
  readonly target: string | null;
}

export const makeClient = (session: SignedIn) => {
  const send = (method: string, path: string, body: unknown) =>
    fetch(path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token()}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const call = async <A>(method: string, path: string, body?: unknown): Promise<A> => {
    let res = await send(method, path, body).catch(() => null);
    if (res?.status === 401) {
      await session.renew();
      res = await send(method, path, body).catch(() => null);
    }
    if (res === null) throw new ApiError(UNREACHABLE, "Unreachable", 0);
    const data: unknown = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      const failure = data as { message?: string; error?: string; closed?: string | null };
      throw new ApiError(
        failure.message ?? "Something went wrong. Try again in a moment.",
        failure.error ?? "",
        res.status,
        failure.closed ?? null,
      );
    }
    return data as A;
  };

  const act = (id: string, verb: string) => call<Acted>("POST", `/api/matches/${id}/${verb}`);

  return {
    /** Who is looking and every open Invite and live Match, read together so they agree. */
    board: async (): Promise<Board> => {
      const [me, list] = await Promise.all([
        call<Me>("GET", "/api/me"),
        call<{ now: number; matches: ReadonlyArray<MatchView> }>("GET", "/api/matches"),
      ]);
      return { me, now: list.now, matches: list.matches };
    },
    /** One Match, also once it has finished; null with why when it's gone. */
    match: (id: string) =>
      call<{ match: MatchView | null }>("GET", `/api/matches/${id}`).then(
        (r) => ({ id, match: r.match, closed: null }),
        (e: unknown) => {
          if (e instanceof ApiError && e.status === 404)
            return { id, match: null, closed: e.closed };
          throw e;
        },
      ),
    personalBest: (id: string) =>
      call<{ ticks: number | null }>("GET", `/api/matches/${id}/pb`).then((r) => r.ticks),
    players: () =>
      call<{ players: ReadonlyArray<Challengeable> }>("GET", "/api/players").then((r) => r.players),
    open: (draft: Draft) => call<{ matchId: string }>("POST", "/api/matches", draft),
    act,
    setPings: (on: boolean) => call<{ pings: boolean }>("POST", "/api/pings", { on }),
    declinePings: () => call<unknown>("POST", "/api/pings/decline"),
    previewLink: (profile: string) => call<LinkPreview>("POST", "/api/link/preview", { profile }),
    confirmLink: () => call<unknown>("POST", "/api/link/confirm"),
  };
};

export type Client = ReturnType<typeof makeClient>;
