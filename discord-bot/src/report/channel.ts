// Where the Daily Report is posted: STATS_CHANNEL_ID, the bot's second channel (Matches stay in
// DISCORD_CHANNEL_ID). Plain REST with the bot's token, so `pnpm report` can post without logging
// a second copy of the bot in. The bot's role needs View Channel, Send Messages, Attach Files,
// Create Public Threads and Send Messages in Threads there; a missing one fails the post, which
// the schedule reports to the ops channel.
import { REST, type RequestData, Routes } from "discord.js";
import { Config, Context, Data, Effect, Layer, Redacted, Schema } from "effect";
import { oneLine } from "../discord/client.js";

export class ReportPostFailed extends Data.TaggedError("ReportPostFailed")<{
  readonly reason: string;
}> {}

export class ReportChannel extends Context.Tag("multiballs/ReportChannel")<
  ReportChannel,
  {
    /** The channel message with its image; its message id. */
    readonly postHead: (
      content: string,
      image: Uint8Array,
    ) => Effect.Effect<string, ReportPostFailed>;
    /** A thread on that message, holding these messages in order. */
    readonly postThread: (
      messageId: string,
      name: string,
      messages: ReadonlyArray<string>,
    ) => Effect.Effect<void, ReportPostFailed>;
  }
>() {}

/** Nobody is ever pinged: a persona or Map title can hold an @ or a <@id>. */
const NO_PINGS = { parse: [] };

/** What Discord answers a created message or thread with; only the id is read. */
const Created = Schema.Struct({ id: Schema.String });

export const ReportChannelLive = Layer.effect(
  ReportChannel,
  Effect.gen(function* () {
    const token = yield* Config.redacted("DISCORD_TOKEN");
    const channelId = yield* Config.string("STATS_CHANNEL_ID");
    const rest = new REST({ version: "10" }).setToken(Redacted.value(token));
    /** A REST call that creates a message or thread: the new id, read from Discord's reply. */
    const create = Effect.fn("ReportChannel.create")(function* (
      op: string,
      route: `/${string}`,
      options: Omit<RequestData, "body"> & { readonly body: object },
    ) {
      const reply = yield* Effect.tryPromise({
        try: () => rest.post(route, options),
        catch: (cause) => new ReportPostFailed({ reason: `${op}: ${oneLine(cause)}` }),
      });
      return yield* Schema.decodeUnknown(Created)(reply).pipe(
        Effect.map((created) => created.id),
        Effect.catchTag("ParseError", () =>
          Effect.fail(new ReportPostFailed({ reason: `${op}: Discord's reply had no id` })),
        ),
      );
    });
    const message = (content: string) => ({ content, allowed_mentions: NO_PINGS });

    return ReportChannel.of({
      postHead: Effect.fn("ReportChannel.postHead")(function* (content, image) {
        return yield* create("post the report", Routes.channelMessages(channelId), {
          body: message(content),
          files: [{ name: "standings.png", data: Buffer.from(image) }],
        });
      }),
      postThread: Effect.fn("ReportChannel.postThread")(function* (messageId, name, messages) {
        const thread = yield* create("start the thread", Routes.threads(channelId, messageId), {
          body: { name, auto_archive_duration: 1440 },
        });
        for (const content of messages)
          yield* create("post in the thread", Routes.channelMessages(thread), {
            body: message(content),
          });
      }),
    });
  }),
);
