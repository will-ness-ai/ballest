// The Activity's HTTP API: the same Player actions as the channel's buttons, over JSON.
// Every route but the token swap needs `Authorization: Bearer <Discord access token>`, from a
// member of the Venue's server the page was opened in, which the page names in GUILD_HEADER.
// Lists, opens, links, names and pings are that Venue's; Links, Chosen Skins and Busy are shared
// by every running Venue (spec #315): a Match in a Venue left out at startup keeps nobody Busy.
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Cache, Clock, Data, Effect, Exit, Option, Ref, Schema } from "effect";
import {
  type Action,
  ACTIONS,
  actionsFor,
  DURATIONS,
  GUILD_HEADER,
  HOME_VENUE,
  involves,
  type Match,
  type PbEvent,
  type VenueName,
} from "../domain.js";
import { Engine, type Rejection } from "../engine.js";
import { explain } from "../explain.js";
import { pingFailed } from "../pingWords.js";
import { Pings, warnPingRole } from "../pings.js";
import {
  type CardView,
  cardView,
  type ChosenSkin,
  ChosenSkins,
  chosenSkinOf,
  MatchLinks,
  type PingRoleUnavailable,
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

/** A running Venue as the Activity serves it: its server, and the channel its links point into. */
export interface ActivityVenue {
  readonly name: VenueName;
  readonly guildId: string;
  readonly channelId: string;
}

/** Who is asking, and in which Venue's server. */
interface Member {
  readonly discordId: string;
  readonly venue: ActivityVenue;
}

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
  readonly skin: ChosenSkin;
}

/** A profile pasted to link, with the account's Chosen Skin for its marble. */
export interface LinkPreview extends ProfilePreview {
  readonly skin: ChosenSkin;
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
const isPingRoleUnavailable = (e: { readonly _tag: string }): e is PingRoleUnavailable =>
  e._tag === "PingRoleUnavailable";

/** `venues` are the running Venues: a page opened in any other server is turned away. */
export const makeActivityApi = Effect.fn("makeActivityApi")(function* (
  venues: ReadonlyArray<ActivityVenue>,
) {
  const auth = yield* DiscordAuth;
  const members = yield* DiscordMembers;
  const places = yield* MatchLinks;
  const store = yield* Store;
  const engine = yield* Engine;
  const chosenSkins = yield* ChosenSkins;
  const pings = yield* Pings;
  /** Each member's last previewed profile, waiting for them to confirm it. */
  const previews = yield* Ref.make(new Map<string, ProfilePreview>());

  /**
   * The Venue whose server the page names. A page that names none was loaded before there were
   * Venues (an Activity left open across the deploy), so it is home's, as it was then.
   */
  const venueOf = (guildId: string | undefined) =>
    guildId === undefined
      ? venues.find((v) => v.name === HOME_VENUE)
      : venues.find((v) => v.guildId === guildId);

  /**
   * An access token in a Venue → Discord id, for members of that Venue's server. A refusal is
   * kept briefly, so a bad token can't hammer Discord.
   */
  const signIns = yield* Cache.makeWith({
    capacity: 1000,
    lookup: (key: { readonly venue: VenueName; readonly token: string }) =>
      Effect.gen(function* () {
        const discordId = yield* auth
          .userOf(key.token)
          .pipe(Effect.mapError(() => new Unauthorized()));
        const member = yield* members
          .nameOf(key.venue, discordId)
          .pipe(Effect.mapError(() => new DiscordUnavailable()));
        if (Option.isNone(member)) return yield* new NotMember();
        return discordId;
      }),
    timeToLive: (exit) => (Exit.isSuccess(exit) ? SIGN_IN_TTL : "5 seconds"),
  });

  /** Who is behind the request's access token, in the Venue its page was opened in. */
  const self = Effect.gen(function* () {
    const { headers } = yield* HttpServerRequest.HttpServerRequest;
    const header = headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token === "") return yield* new Unauthorized();
    // A server that isn't a running Venue is turned away like a server the member isn't in.
    const venue = venueOf(headers[GUILD_HEADER]);
    if (venue === undefined) return yield* new NotMember();
    const discordId = yield* signIns.get(Data.struct({ venue: venue.name, token }));
    const member: Member = { discordId, venue };
    return member;
  });

  /** A member's name in the Venue's server, or "Someone" when Discord can't say. */
  const nameOf = Effect.fn("nameOf")(function* (venue: ActivityVenue, discordId: string) {
    const name = yield* members
      .nameOf(venue.name, discordId)
      .pipe(Effect.catchTag("MembersUnavailable", () => Effect.succeed(Option.none<string>())));
    return Option.getOrElse(name, () => "Someone");
  });

  /** A rejection as the member who was turned down reads it; another member is named as in the server. */
  const rejected = Effect.fn("rejected")(function* (e: Rejection, who: Member) {
    const other =
      "discordId" in e && e.discordId !== who.discordId
        ? yield* nameOf(who.venue, e.discordId)
        : "That member";
    return json({ error: e._tag, message: explain(e, who.discordId, () => other) }, STATUS[e._tag]);
  });

  /** A Match by id if it is this Venue's: another Venue's Match isn't seen from here. */
  const matchIn = Effect.fn("matchIn")(function* (venue: ActivityVenue, id: string) {
    return Option.filter(yield* store.getMatch(id), (m) => m.venue === venue.name);
  });

  /** Fails as not found when the Match is another Venue's, so nothing here can act on it. */
  const notElsewhere = Effect.fn("notElsewhere")(function* (venue: ActivityVenue, id: string) {
    const m = yield* store.getMatch(id);
    if (Option.isSome(m) && m.value.venue !== venue.name)
      return yield* new NotFound({ closed: null });
  });

  /** A Match of the member's Venue as they see it. */
  const viewOf = Effect.fn("viewOf")(function* (m: Match, who: Member) {
    const card = cardView(m, yield* chosenSkins.all);
    const people = card.target === null ? card.players : [...card.players, card.target];
    const names = Object.fromEntries(
      yield* Effect.forEach(people, (p) =>
        nameOf(who.venue, p.discordId).pipe(Effect.map((n) => [p.discordId, n] as const)),
      ),
    );
    // Linked into the channel that holds its Card, in that Venue's server; none if it isn't running.
    const place = yield* places.of(m.id);
    const links = Option.flatMap(place, (p) =>
      Option.map(Option.fromNullable(venues.find((v) => v.name === p.venue)), (where) => {
        const server = `https://discord.com/channels/${where.guildId}`;
        return {
          card: `${server}/${where.channelId}/${p.messageId}`,
          thread: p.threadId === null ? null : `${server}/${p.threadId}`,
        };
      }),
    );
    const view: MatchView = {
      ...card,
      names,
      history: m.history,
      links: Option.getOrNull(links),
      actions: actionsFor(m, who.discordId),
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
    who: Member,
    pingOffer?: boolean,
  ) {
    return json({
      now: yield* Clock.currentTimeMillis,
      match: Option.isSome(m) ? yield* viewOf(m.value, who) : null,
      ...(pingOffer === undefined ? {} : { pingOffer }),
    });
  });

  /**
   * Run a member's action, answering a rejection with its status and words, and a ping role
   * Discord wouldn't change with that Venue's role named.
   */
  const asMember = <E extends { readonly _tag: string }, R>(
    action: (who: Member) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ) =>
    Effect.gen(function* () {
      const who = yield* self;
      return yield* action(who).pipe(
        Effect.catchIf(
          (e): e is Extract<E, Rejection | PingRoleUnavailable> =>
            isRejection(e) || isPingRoleUnavailable(e),
          (e) =>
            isRejection(e)
              ? rejected(e, who)
              : warnPingRole(e).pipe(
                  Effect.andThen(pings.role(who.venue.name)),
                  Effect.map((role) =>
                    json({ error: "PingRoleUnavailable", message: pingFailed(role) }, 503),
                  ),
                ),
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
      asMember((who) =>
        Effect.gen(function* () {
          const { discordId, venue } = who;
          const link = yield* store.getLink(discordId);
          // Their Match in this Venue: one in another running Venue still makes them Busy here.
          const active = (yield* store.activeMatches).find(
            (m) => m.venue === venue.name && involves(m, discordId),
          );
          const chosen = yield* chosenSkins.all;
          return json({
            discordId,
            link: Option.match(link, {
              onNone: () => null,
              onSome: (l) => ({
                steamId: l.steamId,
                personaName: l.personaName,
                skin: chosenSkinOf(chosen, l.steamId),
              }),
            }),
            matchId: active?.id ?? null,
            // Null when Discord can't say just now: the rest of the page still works.
            pings: yield* pings
              .status(venue.name, discordId)
              .pipe(Effect.catchTag("PingRoleUnavailable", () => Effect.succeed(null))),
            // The role as the server names it, for the bell's toasts and the offer.
            pingRole: yield* pings.role(venue.name),
          });
        }),
      ),
    ),
    HttpRouter.post(
      "/api/pings",
      asMember((who) =>
        Effect.gen(function* () {
          const { on } = yield* HttpServerRequest.schemaBodyJson(PingsBody);
          yield* pings.set(who.venue.name, who.discordId, on);
          return json({ pings: on });
        }),
      ),
    ),
    HttpRouter.post(
      "/api/pings/decline",
      asMember((who) =>
        Effect.gen(function* () {
          yield* pings.decline(who.venue.name, who.discordId);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
    HttpRouter.get(
      "/api/players",
      asMember((who) =>
        Effect.gen(function* () {
          const chosen = yield* chosenSkins.all;
          const players = yield* Effect.forEach(
            (yield* store.links).filter((l) => l.discordId !== who.discordId),
            (l) =>
              Effect.gen(function* () {
                const name = yield* members
                  .nameOf(who.venue.name, l.discordId)
                  // Someone Discord can't place just now is left out of the list, like a member who left.
                  .pipe(
                    Effect.catchTag("MembersUnavailable", () =>
                      Effect.succeed(Option.none<string>()),
                    ),
                  );
                // Busy as the engine counts it, in any running Venue.
                const busy = yield* engine.isBusy(l.discordId);
                return Option.map(name, (n): Challengeable => ({
                  discordId: l.discordId,
                  steamId: l.steamId,
                  name: n,
                  steamName: l.personaName,
                  busy,
                  skin: chosenSkinOf(chosen, l.steamId),
                }));
              }),
          );
          // Only members of this Venue's server can be challenged.
          return json({ players: players.flatMap((p) => Option.toArray(p)) });
        }),
      ),
    ),
    HttpRouter.post(
      "/api/link/preview",
      asMember(({ discordId }) =>
        Effect.gen(function* () {
          const { profile } = yield* HttpServerRequest.schemaBodyJson(PreviewBody);
          const preview = yield* engine.previewLink(profile);
          yield* Ref.update(previews, (m) => new Map(m).set(discordId, preview));
          const shown: LinkPreview = {
            ...preview,
            skin: chosenSkinOf(yield* chosenSkins.all, preview.steamId),
          };
          return json(shown);
        }),
      ),
    ),
    HttpRouter.post(
      "/api/link/confirm",
      asMember(({ discordId }) =>
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
      asMember((who) =>
        Effect.gen(function* () {
          const matches = yield* Effect.forEach(
            (yield* store.activeMatches).filter((m) => m.venue === who.venue.name),
            (m) => viewOf(m, who),
          );
          return json({ now: yield* Clock.currentTimeMillis, matches });
        }),
      ),
    ),
    HttpRouter.post(
      "/api/matches",
      asMember((who) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.schemaBodyJson(OpenBody);
          return json({
            matchId: yield* engine.openInvite(who.venue.name, who.discordId, request),
          });
        }),
      ),
    ),
    HttpRouter.get(
      "/api/matches/:id",
      asMember((who) =>
        Effect.gen(function* () {
          const { id = "" } = yield* HttpRouter.params;
          const m = yield* matchIn(who.venue, id);
          if (Option.isNone(m))
            return yield* new NotFound({ closed: yield* engine.whyClosed(who.venue.name, id) });
          return yield* reply(m, who);
        }),
      ),
    ),
    HttpRouter.get(
      "/api/matches/:id/pb",
      asMember((who) =>
        Effect.gen(function* () {
          const { id = "" } = yield* HttpRouter.params;
          yield* notElsewhere(who.venue, id);
          return json({ ticks: yield* engine.personalBest(who.discordId, id) });
        }),
      ),
    ),
    HttpRouter.post(
      "/api/matches/:id/:action",
      asMember((who) =>
        Effect.gen(function* () {
          const { id = "", action = "" } = yield* HttpRouter.params;
          const known = ACTIONS.find((a) => a === action);
          if (known === undefined) return yield* new NotFound({ closed: null });
          yield* notElsewhere(who.venue, id);
          yield* engine[known](who.discordId, id);
          return yield* reply(
            yield* store.getMatch(id),
            who,
            yield* pings.offerAfter(who.venue.name, known, who.discordId),
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
              message: "Multiballs doesn't run in this server.",
            },
            403,
          ),
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
