// Who is using the Activity. Discord's Embedded App SDK hands the page an OAuth code; the server
// swaps it for an access token (that needs the app's client secret, so it can't happen in the
// page), and every later request carries that token, which Discord maps back to a user.
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform"
import { Config, Context, Data, Effect, Layer, type Option, Redacted, Schema } from "effect"

export class AuthFailed extends Data.TaggedError("AuthFailed")<{ readonly reason: string }> {}

export class DiscordAuth extends Context.Tag("multiballs/DiscordAuth")<
  DiscordAuth,
  {
    /** An OAuth code from the SDK's `authorize`, swapped for an access token. */
    readonly exchange: (code: string) => Effect.Effect<string, AuthFailed>
    /** The Discord id an access token belongs to. */
    readonly userOf: (accessToken: string) => Effect.Effect<string, AuthFailed>
  }
>() {}

/** Who is in the Ballest server, and what they're called there. */
export class DiscordMembers extends Context.Tag("multiballs/DiscordMembers")<
  DiscordMembers,
  {
    /** A member's display name in the server; None if they aren't in it. */
    readonly nameOf: (discordId: string) => Effect.Effect<Option.Option<string>>
  }
>() {}

const API = "https://discord.com/api/v10"

const TokenReply = Schema.Struct({ access_token: Schema.String })
const UserReply = Schema.Struct({ id: Schema.String })

/** The real thing: Discord's OAuth2 token endpoint and `/users/@me`. */
export const DiscordAuthLive = Layer.effect(
  DiscordAuth,
  Effect.gen(function* () {
    const clientId = yield* Config.string("DISCORD_APPLICATION_ID")
    const secret = yield* Config.redacted("DISCORD_CLIENT_SECRET")
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const failed = (what: string) => (e: { readonly message: string }) => new AuthFailed({ reason: `${what}: ${e.message}` })
    return DiscordAuth.of({
      exchange: (code) =>
        http
          .execute(
            HttpClientRequest.post(`${API}/oauth2/token`).pipe(
              HttpClientRequest.bodyUrlParams({
                client_id: clientId,
                client_secret: Redacted.value(secret),
                grant_type: "authorization_code",
                code
              })
            )
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenReply)),
            Effect.map((r) => r.access_token),
            Effect.scoped,
            Effect.mapError(failed("token exchange"))
          ),
      userOf: (accessToken) =>
        http.execute(HttpClientRequest.get(`${API}/users/@me`).pipe(HttpClientRequest.bearerToken(accessToken))).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(UserReply)),
          Effect.map((u) => u.id),
          Effect.scoped,
          Effect.mapError(failed("who is this"))
        )
    })
  })
).pipe(Layer.provide(FetchHttpClient.layer))
