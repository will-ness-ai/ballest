// Who is using the Activity. Discord's Embedded App SDK hands the page an OAuth code; the server
// swaps it for an access token (that needs the app's client secret, so it can't happen in the
// page), and every later request carries that token, which Discord maps back to a user.
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Config, Context, Data, Effect, Layer, type Option, Redacted, Schema } from "effect";

export class AuthFailed extends Data.TaggedError("AuthFailed")<{ readonly reason: string }> {}
/** Discord couldn't say who is in the server just now. */
export class MembersUnavailable extends Data.TaggedError("MembersUnavailable")<{
  readonly reason: string;
}> {}

export class DiscordAuth extends Context.Tag("multiballs/DiscordAuth")<
  DiscordAuth,
  {
    /** An OAuth code from the SDK's `authorize`, swapped for an access token. */
    readonly exchange: (code: string) => Effect.Effect<string, AuthFailed>;
    /** The Discord id an access token belongs to. */
    readonly userOf: (accessToken: string) => Effect.Effect<string, AuthFailed>;
  }
>() {}

/** Who is in the Ballest server, and what they're called there. */
export class DiscordMembers extends Context.Tag("multiballs/DiscordMembers")<
  DiscordMembers,
  {
    /** A member's display name in the server; None if they aren't in it. */
    readonly nameOf: (
      discordId: string,
    ) => Effect.Effect<Option.Option<string>, MembersUnavailable>;
  }
>() {}

const API = "https://discord.com/api/v10";

const TokenReply = Schema.Struct({ access_token: Schema.String });
const UserReply = Schema.Struct({ id: Schema.String });

/** The real thing: Discord's OAuth2 token endpoint and `/users/@me`. */
export const DiscordAuthLive = Layer.effect(
  DiscordAuth,
  Effect.gen(function* () {
    const clientId = yield* Config.string("DISCORD_APPLICATION_ID");
    const secret = yield* Config.redacted("DISCORD_CLIENT_SECRET");
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const failed = (what: string, e: { readonly message: string }) =>
      new AuthFailed({ reason: `${what}: ${e.message}` });
    return DiscordAuth.of({
      exchange: Effect.fn("exchange")(function* (code: string) {
        const request = HttpClientRequest.post(`${API}/oauth2/token`).pipe(
          HttpClientRequest.bodyUrlParams({
            client_id: clientId,
            client_secret: Redacted.value(secret),
            grant_type: "authorization_code",
            code,
          }),
        );
        const reply = yield* http.execute(request).pipe(
          Effect.flatMap((response) => HttpClientResponse.schemaBodyJson(TokenReply)(response)),
          Effect.scoped,
          Effect.mapError((e) => failed("token exchange", e)),
        );
        return reply.access_token;
      }),
      userOf: Effect.fn("userOf")(function* (accessToken: string) {
        const request = HttpClientRequest.get(`${API}/users/@me`).pipe(
          HttpClientRequest.bearerToken(accessToken),
        );
        const user = yield* http.execute(request).pipe(
          Effect.flatMap((response) => HttpClientResponse.schemaBodyJson(UserReply)(response)),
          Effect.scoped,
          Effect.mapError((e) => failed("who is this", e)),
        );
        return user.id;
      }),
    });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
