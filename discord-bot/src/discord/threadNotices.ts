// Discord posts a "MULTIBALLS started a thread" notice in the channel for every Match Thread.
// The bot deletes them, so the channel holds only Cards and the Footer. They're the bot's own
// messages, so no extra permission is needed.
import { type Message, MessageType, type TextChannel } from "discord.js";
import { Effect } from "effect";
import { describeDiscordError, isUnknown, tryDiscord } from "./client.js";

/** How far back the startup sweep reads: pages of PAGE messages. */
const PAGE = 100;
const SWEEP_PAGES = 10;
/** Where, and how many times, a new thread's notice is looked for while Discord posts it. */
const NOTICE_WINDOW = 10;
const NOTICE_TRIES = 3;
const NOTICE_WAIT = "500 millis";

export const makeThreadNotices = (channel: TextChannel) => {
  const isNoticeOf = (m: Message, threadId: string | null) =>
    m.type === MessageType.ThreadCreated &&
    m.author.id === channel.client.user.id &&
    (threadId === null || m.reference?.channelId === threadId);

  /** Delete one notice; one already gone counts as done. Whether it was deleted. */
  const deleteNotice = (m: Message) =>
    tryDiscord("delete thread notice", () => m.delete()).pipe(
      Effect.as(true),
      Effect.catchTag("DiscordError", (e) =>
        isUnknown(e)
          ? Effect.succeed(false)
          : Effect.logWarning(`thread notice left in place: ${describeDiscordError(e)}`).pipe(
              Effect.as(false),
            ),
      ),
    );

  return {
    /** A new thread's notice, looked for a few times in case Discord hasn't posted it yet. */
    deleteNoticeOf: Effect.fn("deleteNoticeOf")(
      function* (threadId: string) {
        for (let attempt = 1; attempt <= NOTICE_TRIES; attempt++) {
          const recent = yield* tryDiscord("fetch recent messages", () =>
            channel.messages.fetch({ limit: NOTICE_WINDOW }),
          );
          const notice = [...recent.values()].find((m) => isNoticeOf(m, threadId));
          if (notice !== undefined) return yield* deleteNotice(notice);
          if (attempt < NOTICE_TRIES) yield* Effect.sleep(NOTICE_WAIT);
        }
        yield* Effect.logWarning(
          `no thread notice found for thread ${threadId}; the next start's sweep deletes it`,
        );
        return false;
      },
      Effect.catchTag("DiscordError", (e) =>
        Effect.logWarning(`thread notice left in place: ${describeDiscordError(e)}`).pipe(
          Effect.as(false),
        ),
      ),
    ),

    /** Every notice in the channel's recent history: ones from before this fix, or a failed delete. */
    sweep: Effect.fn("sweepThreadNotices")(
      function* () {
        let before: string | undefined;
        let deleted = 0;
        for (let page = 0; page < SWEEP_PAGES; page++) {
          const cursor = before;
          const batch = yield* tryDiscord("fetch channel history", () =>
            channel.messages.fetch(
              cursor === undefined ? { limit: PAGE } : { limit: PAGE, before: cursor },
            ),
          );
          for (const m of batch.values())
            if (isNoticeOf(m, null) && (yield* deleteNotice(m))) deleted++;
          if (batch.size < PAGE) break;
          before = batch.last()?.id;
        }
        if (deleted > 0) yield* Effect.log(`deleted ${deleted} thread notices`);
      },
      Effect.catchTag("DiscordError", (e) =>
        Effect.logWarning(`thread notice sweep stopped: ${describeDiscordError(e)}`),
      ),
    ),
  };
};
