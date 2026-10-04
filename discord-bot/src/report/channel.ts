// Where the Daily Report is posted: STATS_CHANNEL_ID, the bot's second channel (Matches stay in
// DISCORD_CHANNEL_ID). Plain REST with the bot's token, so `pnpm report` can post without logging
// a second copy of the bot in. The bot's role needs View Channel, Send Messages, Attach Files,
// Create Public Threads and Send Messages in Threads there; a missing one fails the post, which
// the schedule reports to the ops channel.
import { REST, type RequestData, Routes } from "discord.js";
import { Config, Context, Data, Effect, Layer, Redacted, Schema } from "effect";
import { oneLine } from "../discord/client.js";

/** Nothing was posted. */
export class ReportPostFailed extends Data.TaggedError("ReportPostFailed")<{
  readonly reason: string;
}> {}

/** The channel message is up, but its thread isn't (or is only partly). */
export class ThreadPostFailed extends Data.TaggedError("ThreadPostFailed")<{
  readonly messageId: string;
  readonly reason: string;
}> {}

/** One Daily Report as Discord gets it. */
export interface ReportPost {
  /** The channel message, with the standings image attached. */
  readonly content: string;
  readonly image: Uint8Array;
  /** A thread on that message, holding these messages in order. */
  readonly threadName: string;
  readonly thread: ReadonlyArray<string>;
}

export class ReportChannel extends Context.Tag("multiballs/ReportChannel")<
  ReportChannel,
  {
    /** Post the report; the channel message's id. */
    readonly post: (
      report: ReportPost,
    ) => Effect.Effect<string, ReportPostFailed | ThreadPostFailed>;
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

    const postThread = Effect.fn("ReportChannel.postThread")(function* (
      messageId: string,
      report: ReportPost,
    ) {
      const thread = yield* create("start the thread", Routes.threads(channelId, messageId), {
        body: { name: report.threadName, auto_archive_duration: 1440 },
      });
      for (const content of report.thread)
        yield* create("post in the thread", Routes.channelMessages(thread), {
          body: message(content),
        });
    });

    return ReportChannel.of({
      post: Effect.fn("ReportChannel.post")(function* (report) {
        const messageId = yield* create("post the report", Routes.channelMessages(channelId), {
          body: message(report.content),
          files: [{ name: "standings.png", data: Buffer.from(report.image) }],
        });
        yield* postThread(messageId, report).pipe(
          Effect.catchTag("ReportPostFailed", (e) =>
            Effect.fail(new ThreadPostFailed({ messageId, reason: e.reason })),
          ),
        );
        return messageId;
      }),
    });
  }),
);
