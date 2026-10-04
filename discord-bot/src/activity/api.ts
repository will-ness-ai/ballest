// The Activity's HTTP API: the same Player actions as the channel's buttons, over JSON.
// Every route but the token swap needs `Authorization: Bearer <Discord access token>`, from a
// member of the Ballest server.
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Cache, Clock, Data, Effect, Exit, Option, Ref, Schema } from "effect";
import {
  type Action,
  ACTIONS,
  actionsFor,
  DURATIONS,
  involves,
  type Match,
  type PbEvent,
} from "../domain.js";
import { Engine, type Rejection } from "../engine.js";
import { explain } from "../explain.js";
import { pingFailed } from "../pingWords.js";
import { Pings, warnPingRole } from "../pings.js";
import {
  type CardView,
  cardView,
  MatchLinks,
  type ProfilePreview,
  type RemovalReason,
  Store,
} from "../ports.js";
import { DiscordAuth, DiscordMembers } from "./auth.js";

class Unauthorized extends Data.TaggedError("Unauthorized") {}
class NotMember extends Data.TaggedError("NotMember") {}
/** Confirm with no profile previewed by this member first. */
class NoPreview extends Data.TaggedError("NoPreview") {}
/** No such Match, or it's gone; `closed` says why, when it ended without a Result lately. */
class NotFound extends Data.TaggedError("NotFound")<{ readonly closed: RemovalReason | null }> {}
/** Discord couldn't say who is in the server, so nobody is let in for now. */
class DiscordUnavailable extends Data.TaggedError("DiscordUnavailable") {}

const STATUS: Record<Rejection["_tag"], number> = {
  NotLinked: 403,
  Busy: 409,
  MatchNotFound: 404,
  NotOpen: 409,
  NotAllowed: 403,
  NoEligibleMap: 409,
  SteamUnavailable: 503,
  ProfileNotFound: 404,
};

/** How long a sign-in is trusted before Discord is asked about the token again. */
const SIGN_IN_TTL = "10 minutes";

/**
 * A Match as the page draws it: its Card, with what only the page needs. The page lays out the
 * same rows and words as the Card (present.ts) and the same PBs as the Match Thread (`progress`).
 */
export interface MatchView extends CardView {
  /** Each Player's name in the server, and the Challenge's opponent's, by Discord id. */
  readonly names: Readonly<Record<string, string>>;
  /** Every PB set during the Match, in order, for the graph and the Improvements feed. */
  readonly history: ReadonlyArray<PbEvent>;
  /** Its Card and Match Thread in the channel, once they're there. */
  readonly links: { readonly card: string; readonly thread: string | null } | null;
  /** What the viewer may press on it. */
  readonly actions: ReadonlyArray<Action>;
  /** Its Map is being drawn right now: the start has been pressed. */
  readonly starting: boolean;
}

/** A linked member the page can challenge. */
export interface Challengeable {
  readonly discordId: string;
  readonly steamId: string;
  readonly name: string;
  readonly steamName: string;
  /** In an open Invite or a live Match, so they can't be challenged now. */
  readonly busy: boolean;
}

const json = (body: unknown, status = 200) => HttpServerResponse.unsafeJson(body, { status });

const TokenBody = Schema.Struct({ code: Schema.String });
const PreviewBody = Schema.Struct({ profile: Schema.String });
const PingsBody = Schema.Struct({ on: Schema.Boolean });
const OpenBody = Schema.Struct({
  type: Schema.Literal("public", "challenge", "lobby"),
  minutes: Schema.Literal(...DURATIONS),
  target: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
});

const isRejection = (e: { readonly _tag: string }): e is Rejection => e._tag in STATUS;

/** `where` is the server and channel the links point into. */
export const makeActivityApi = Effect.fn("makeActivityApi")(function* (where: {
  readonly guildId: string;
  readonly channelId: string;
}) {
  const auth = yield* DiscordAuth;
  const members = yield* DiscordMembers;
  const places = yield* MatchLinks;
  const store = yield* Store;
  const engine = yield* Engine;
  const pings = yield* Pings;
  /** Each member's last previewed profile, waiting for them to confirm it. */
  const previews = yield* Ref.make(new Map<string, ProfilePreview>());

  /** Access token → Discord id, for members of the server. A refusal is kept briefly, so a bad token can't hammer Discord. */
  const signIns = yield* Cache.makeWith({
    capacity: 1000,
    lookup: (token: string) =>
      Effect.gen(function* () {
        const discordId = yield* auth.userOf(token).pipe(Effect.mapError(() => new Unauthorized()));
        const member = yield* members
          .nameOf(discordId)
          .pipe(Effect.mapError(() => new DiscordUnavailable()));
        if (Option.isNone(member)) return yield* new NotMember();
        return discordId;
      }),
    timeToLive: (exit) => (Exit.isSuccess(exit) ? SIGN_IN_TTL : "5 seconds"),
  });

  /** The Discord id behind the request's access token. */
  const self = Effect.gen(function* () {
    const header = (yield* HttpServerRequest.HttpServerRequest).headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token === "") return yield* new Unauthorized();
    return yield* signIns.get(token);
  });

  /** A member's name in the server, or "Someone" when Discord can't say. */
  const nameOf = Effect.fn("nameOf")(function* (discordId: string) {
    const name = yield* members
      .nameOf(discordId)
      .pipe(Effect.catchTag("MembersUnavailable", () => Effect.succeed(Option.none<string>())));
    return Option.getOrElse(name, () => "Someone");
  });

  /** A rejection as the member who was turned down reads it; another member is named as in the server. */
  const rejected = Effect.fn("rejected")(function* (e: Rejection, discordId: string) {
    const other =
      "discordId" in e && e.discordId !== discordId ? yield* nameOf(e.discordId) : "That member";
    return json({ error: e._tag, message: explain(e, discordId, () => other) }, STATUS[e._tag]);
  });

  /** A Match as `discordId` sees it. */
  const viewOf = Effect.fn("viewOf")(function* (m: Match, discordId: string) {
    const card = cardView(m);
    const people = card.target === null ? card.players : [...card.players, card.target];
    const names = Object.fromEntries(
      yield* Effect.forEach(people, (p) =>
        nameOf(p.discordId).pipe(Effect.map((n) => [p.discordId, n] as const)),
      ),
    );
    const place = yield* places.of(m.id);
    const channel = `https://discord.com/channels/${where.guildId}`;
    const view: MatchView = {
      ...card,
      names,
      history: m.history,
      links: Option.match(place, {
        onNone: () => null,
        onSome: (p) => ({
          card: `${channel}/${where.channelId}/${p.messageId}`,
          thread: p.threadId === null ? null : `${channel}/${p.threadId}`,
        }),
      }),
      actions: actionsFor(m, discordId),
      starting: yield* engine.isStarting(m.id),
    };
    return view;
  });

  /**
   * A Match as it stands (null once it's gone), with the server's clock for the countdowns, and,
   * after a member's own action on it, whether to offer them the ping role.
   */
  const reply = Effect.fn("reply")(function* (
    m: Option.Option<Match>,
    discordId: string,
    pingOffer?: boolean,
  ) {
    return json({
      now: yield* Clock.currentTimeMillis,
      match: Option.isSome(m) ? yield* viewOf(m.value, discordId) : null,
      ...(pingOffer === undefined ? {} : { pingOffer }),
    });
  });

  /** Run a member's action, answering a rejection with its status and words. */
  const asMember = <E extends { readonly _tag: string }, R>(
    action: (discordId: string) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ) =>
    Effect.gen(function* () {
      const discordId = yield* self;
      return yield* action(discordId).pipe(
        Effect.catchIf(
          (e): e is Extract<E, Rejection> => isRejection(e),
          (e) => rejected(e, discordId),
        ),
      );
    });

  const router = HttpRouter.empty.pipe(
    HttpRouter.post(
      "/api/token",
      Effect.gen(function* () {
        const { code } = yield* HttpServerRequest.schemaBodyJson(TokenBody);
        const token = yield* auth
          .exchange(code)
          .pipe(Effect.tapError((e) => Effect.logWarning(`activity sign-in failed: ${e.reason}`)));
        return json({ access_token: token });
      }),
    ),
    HttpRouter.get(
      "/api/me",
      asMember((discordId) =>
        Effect.gen(function* () {
          const link = yield* store.getLink(discordId);
          const active = (yield* store.activeMatches).find((m) => involves(m, discordId));
          return json({
            discordId,
            link: Option.match(link, {
              onNone: () => null,
              onSome: (l) => ({ steamId: l.steamId, personaName: l.personaName }),
            }),
            matchId: active?.id ?? null,
            // Null when Discord can't say just now: the rest of the page still works.
            pings: yield* pings
              .status(discordId)
              .pipe(Effect.catchTag("PingRoleUnavailable", () => Effect.succeed(null))),
            // The role as the server names it, for the bell's toasts and the offer.
            pingRole: pings.role,
          });
        }),
      ),
    ),
    HttpRouter.post(
      "/api/pings",
      asMember((discordId) =>
        Effect.gen(function* () {
          const { on } = yield* HttpServerRequest.schemaBodyJson(PingsBody);
          yield* pings.set(discordId, on);
          return json({ pings: on });
        }),
      ),
    ),
    HttpRouter.post(
      "/api/pings/decline",
      asMember((discordId) =>
        Effect.gen(function* () {
          yield* pings.decline(discordId);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
    HttpRouter.get(
      "/api/players",
      asMember((discordId) =>
        Effect.gen(function* () {
          const active = yield* store.activeMatches;
          const players = yield* Effect.forEach(
            (yield* store.links).filter((l) => l.discordId !== discordId),
            (l) =>
              members.nameOf(l.discordId).pipe(
                // Someone Discord can't place just now is left out of the list, like a member who left.
                Effect.catchTag("MembersUnavailable", () => Effect.succeed(Option.none<string>())),
                Effect.map((name) =>
                  Option.map(name, (n): Challengeable => ({
                    discordId: l.discordId,
                    steamId: l.steamId,
                    name: n,
                    steamName: l.personaName,
                    busy: active.some((m) => involves(m, l.discordId)),
                  })),
                ),
              ),
          );
          // Only members still in the server can be challenged.
          return json({ players: players.flatMap((p) => Option.toArray(p)) });
        }),
      ),
    ),
    HttpRouter.post(
      "/api/link/preview",
      asMember((discordId) =>
        Effect.gen(function* () {
          const { profile } = yield* HttpServerRequest.schemaBodyJson(PreviewBody);
          const preview = yield* engine.previewLink(profile);
          yield* Ref.update(previews, (m) => new Map(m).set(discordId, preview));
          return json(preview);
        }),
      ),
    ),
    HttpRouter.post(
      "/api/link/confirm",
      asMember((discordId) =>
        Effect.gen(function* () {
          const preview = (yield* Ref.get(previews)).get(discordId);
          if (preview === undefined) return yield* new NoPreview();
          yield* engine.confirmLink(discordId, preview);
          yield* Ref.update(previews, (m) => {
            const next = new Map(m);
            next.delete(discordId);
            return next;
          });
          return json({ steamId: preview.steamId, personaName: preview.personaName });
        }),
      ),
    ),
    HttpRouter.get(
      "/api/matches",
      asMember((discordId) =>
        Effect.gen(function* () {
          const matches = yield* Effect.forEach(yield* store.activeMatches, (m) =>
            viewOf(m, discordId),
          );
          return json({ now: yield* Clock.currentTimeMillis, matches });
        }),
      ),
    ),
    HttpRouter.post(
      "/api/matches",
      asMember((discordId) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.schemaBodyJson(OpenBody);
          return json({ matchId: yield* engine.openInvite(discordId, request) });
        }),
      ),
    ),
    HttpRouter.get(
      "/api/matches/:id",
      asMember((discordId) =>
        Effect.gen(function* () {
          const { id = "" } = yield* HttpRouter.params;
          const m = yield* store.getMatch(id);
          if (Option.isNone(m)) return yield* new NotFound({ closed: yield* engine.whyClosed(id) });
          return yield* reply(m, discordId);
        }),
      ),
    ),
    HttpRouter.get(
      "/api/matches/:id/pb",
      asMember((discordId) =>
        Effect.gen(function* () {
          const { id = "" } = yield* HttpRouter.params;
          return json({ ticks: yield* engine.personalBest(discordId, id) });
        }),
      ),
    ),
    HttpRouter.post(
      "/api/matches/:id/:action",
      asMember((discordId) =>
        Effect.gen(function* () {
          const { id = "", action = "" } = yield* HttpRouter.params;
          const known = ACTIONS.find((a) => a === action);
          if (known === undefined) return yield* new NotFound({ closed: null });
          yield* engine[known](discordId, id);
          return yield* reply(
            yield* store.getMatch(id),
            discordId,
            yield* pings.offerAfter(known, discordId),
          );
        }),
      ),
    ),
  );

  return router.pipe(
    Effect.catchTags({
      Unauthorized: () =>
        Effect.succeed(json({ error: "Unauthorized", message: "Sign in again." }, 401)),
      NotMember: () =>
        Effect.succeed(
          json(
            {
              error: "NotMember",
              message: "Multiballs only runs in the Ballest server. Open it from a channel there.",
            },
            403,
          ),
        ),
      PingRoleUnavailable: (e) =>
        warnPingRole(e).pipe(
          Effect.as(json({ error: "PingRoleUnavailable", message: pingFailed(pings.role) }, 503)),
        ),
      DiscordUnavailable: () =>
        Effect.succeed(
          json(
            {
              error: "DiscordUnavailable",
              message: "Discord didn't answer. Try again in a moment.",
            },
            503,
          ),
        ),
      NotFound: (e) => Effect.succeed(json({ error: "NotFound", closed: e.closed }, 404)),
      RouteNotFound: () => Effect.succeed(json({ error: "NotFound", closed: null }, 404)),
      NoPreview: () =>
        Effect.succeed(
          json(
            { error: "NoPreview", message: "That check expired. Paste your profile again." },
            409,
          ),
        ),
      AuthFailed: () =>
        Effect.succeed(json({ error: "Unauthorized", message: "Sign in again." }, 401)),
      RequestError: () => Effect.succeed(json({ error: "BadRequest" }, 400)),
      ParseError: () => Effect.succeed(json({ error: "BadRequest" }, 400)),
    }),
  );
});
