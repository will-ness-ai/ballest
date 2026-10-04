// Where the Daily Report is posted: STATS_CHANNEL_ID, the bot's second channel (Matches stay in
// DISCORD_CHANNEL_ID). Plain REST with the bot's token, so `pnpm report` can post without logging
// a second copy of the bot in. The bot's role needs View Channel, Send Messages, Attach Files,
// Create Public Threads and Send Messages in Threads there; a missing one fails the post, which
// the schedule reports to the ops channel.
import { REST, Routes } from "discord.js";
import { Config, Context, Data, Effect, Layer, Redacted } from "effect";
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

export const ReportChannelLive = Layer.effect(
  ReportChannel,
  Effect.gen(function* () {
    const token = yield* Config.redacted("DISCORD_TOKEN");
    const channelId = yield* Config.string("STATS_CHANNEL_ID");
    const rest = new REST({ version: "10" }).setToken(Redacted.value(token));
    const call = <A>(op: string, run: () => Promise<unknown>) =>
      Effect.tryPromise({
        try: () => run() as Promise<A>,
        catch: (cause) => new ReportPostFailed({ reason: `${op}: ${oneLine(cause)}` }),
      });
    const send = (to: string, content: string) =>
      call<{ id: string }>("post a message", () =>
        rest.post(Routes.channelMessages(to), { body: { content, allowed_mentions: NO_PINGS } }),
      );

    return ReportChannel.of({
      postHead: (content, image) =>
        call<{ id: string }>("post the report", () =>
          rest.post(Routes.channelMessages(channelId), {
            body: { content, allowed_mentions: NO_PINGS },
            files: [{ name: "standings.png", data: Buffer.from(image) }],
          }),
        ).pipe(Effect.map((m) => m.id)),
      postThread: Effect.fn("ReportChannel.postThread")(function* (messageId, name, messages) {
        const thread = yield* call<{ id: string }>("start the thread", () =>
          rest.post(Routes.threads(channelId, messageId), {
            body: { name, auto_archive_duration: 1440 },
          }),
        );
        for (const content of messages) yield* send(thread.id, content);
      }),
    });
  }),
);
