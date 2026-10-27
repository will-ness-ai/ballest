// How the Weekly Cup's messages are kept on Discord (spec #353): the CupChannel port over one
// channel's messages (a MessageSink, which live.ts makes from discord.js). Each slot's view is
// drawn as one or more messages: a first post of a one-time slot goes with a nonce Discord
// enforces, so a send repeated after a restart is dropped; an edit is made only where a message
// would change; a message someone deleted (Unknown Message) is posted afresh; and a view that now
// takes more or fewer messages posts or drops the difference. The standings and results carry a
// picture (CupPictures: the Renderer, with the Entrants' names), drawn again only when what it
// shows changes.
import { createHash } from "node:crypto";
import { Effect } from "effect";
import {
  describeDiscordError,
  type DiscordError,
  hasCode,
  UNKNOWN_MESSAGE,
} from "../discord/client.js";
import { fingerprint, type Payload } from "../discord/messages.js";
import type { RenderError } from "../render/renderer.js";
import type { CupStandingsImage } from "../render/scenes.js";
import {
  cupNoticeMessage,
  cupResultsMessages,
  cupStandingsClosedMessage,
  cupStandingsImage,
  cupStandingsMessage,
  shortlistMessage,
  weeklyCupMessage,
} from "./messages.js";
import {
  CupChannel,
  type CupNotice,
  CupPostFailed,
  type ShowOptions,
  type Slot,
  type SlotViews,
  type StandingsView,
} from "./model.js";

/** A payload as it is first sent: perhaps with a nonce Discord enforces. */
export type SentPayload = Payload & { readonly nonce?: string; readonly enforceNonce?: boolean };

/** One channel's messages, as the slots need them. */
export interface MessageSink {
  /** The new message's id. */
  readonly send: (payload: SentPayload) => Effect.Effect<string, DiscordError>;
  readonly edit: (messageId: string, payload: Payload) => Effect.Effect<void, DiscordError>;
  readonly drop: (messageId: string) => Effect.Effect<void, DiscordError>;
}

/**
 * A one-time post with a nonce of its server, week and kind that Discord enforces: sent again
 * within a few minutes, as a restart between the send and its record would, Discord returns the
 * first message instead of posting a second. Discord matches a nonce across every channel the bot
 * posts in, so the server is part of it, or two servers' posts at the same moment would be one;
 * a hash keeps it within Discord's 25 characters.
 */
export const sentOnce = (
  payload: Payload,
  guildId: string,
  week: string,
  kind: string,
): SentPayload => ({
  ...payload,
  nonce: createHash("sha256")
    .update(`cup:${guildId}:${week}:${kind}`)
    .digest("base64url")
    .slice(0, 25),
  enforceNonce: true,
});

/** How the standings' picture is drawn: the Entrants' names in the server, and the Renderer. */
export interface CupPictures {
  readonly nameOf: (discordId: string) => Effect.Effect<string>;
  readonly standings: (image: CupStandingsImage) => Effect.Effect<Uint8Array, RenderError>;
}
/** The slots whose first post goes once; the standings are redrawn every read, and need none. */
const ONCE: Readonly<Record<Slot, boolean>> = {
  post: true,
  shortlist: true,
  standings: false,
  results: true,
};

const refused = (e: DiscordError) => new CupPostFailed({ reason: describeDiscordError(e) });
const gone = (e: DiscordError) => hasCode(e, UNKNOWN_MESSAGE);

/** The CupChannel port over a channel's messages, in server `guildId`. */
export const cupChannelOver = (sink: MessageSink, guildId: string, pictures: CupPictures) => {
  /** What each message shows (its fingerprint), so an unchanged one isn't edited. */
  const drawn = new Map<string, string>();
  /** Each slot's last picture, by what it shows, so an unchanged one isn't drawn again. */
  const painted = new Map<Slot, { readonly shows: string; readonly png: Uint8Array }>();

  /** The standings' or results' picture for this view. */
  const picture = Effect.fn("cupChannel.picture")(function* (slot: Slot, view: StandingsView) {
    const names = new Map<string, string>();
    for (const o of view.standings.overall)
      names.set(o.discordId, yield* pictures.nameOf(o.discordId));
    const image = cupStandingsImage(view, names);
    const shows = JSON.stringify(image);
    const last = painted.get(slot);
    if (last?.shows === shows) return last.png;
    const png = yield* pictures
      .standings(image)
      .pipe(
        Effect.mapError(
          (e) => new CupPostFailed({ reason: `couldn't draw the standings: ${String(e.cause)}` }),
        ),
      );
    painted.set(slot, { shows, png });
    return png;
  });

  /** Each slot's messages for its view. */
  const draw = (
    slot: Slot,
    view: SlotViews[Slot],
  ): Effect.Effect<ReadonlyArray<Payload>, CupPostFailed> => {
    switch (slot) {
      case "post":
        return Effect.succeed([weeklyCupMessage(view as SlotViews["post"])]);
      case "shortlist":
        return Effect.succeed([shortlistMessage(view as SlotViews["shortlist"])]);
      case "standings": {
        const v = view as SlotViews["standings"];
        // Shown final, once the results are up, they only point to them: no picture.
        return v.final
          ? Effect.succeed([cupStandingsClosedMessage(v)])
          : Effect.map(picture(slot, v), (png) => [cupStandingsMessage(v, png)]);
      }
      case "results": {
        const v = view as SlotViews["results"];
        return Effect.map(picture(slot, v), (png) => cupResultsMessages(v, png));
      }
    }
  };

  const post = Effect.fn("cupChannel.post")(function* (
    slot: Slot,
    week: string,
    parts: ReadonlyArray<Payload>,
    once: boolean,
  ) {
    const ids: Array<string> = [];
    for (const [i, part] of parts.entries()) {
      const kind = slot === "results" ? `results-${i + 1}` : slot;
      const id = yield* sink
        .send(once ? sentOnce(part, guildId, week, kind) : part)
        .pipe(Effect.mapError(refused));
      drawn.set(id, fingerprint(part));
      ids.push(id);
    }
    return ids;
  });

  const drop = Effect.fn("cupChannel.drop")(function* (messageId: string) {
    drawn.delete(messageId);
    yield* sink.drop(messageId).pipe(
      Effect.catchIf(gone, () => Effect.void),
      Effect.mapError(refused),
    );
  });

  /** Redraw `parts` over `shown`: their ids, or Discord's answer when a message there was deleted. */
  const redraw = Effect.fn("cupChannel.redraw")(function* (
    slot: Slot,
    week: string,
    shown: ReadonlyArray<string>,
    parts: ReadonlyArray<Payload>,
  ) {
    const ids: Array<string> = [];
    for (const [i, part] of parts.entries()) {
      const id = shown[i];
      if (id === undefined) {
        ids.push(...(yield* post(slot, week, [part], false)));
        continue;
      }
      const print = fingerprint(part);
      if (drawn.get(id) !== print) {
        // A message with pictures puts them up again in place of the old (`attachments: []`).
        const edit = (part.files?.length ?? 0) > 0 ? { ...part, attachments: [] } : part;
        const edited = yield* Effect.either(sink.edit(id, edit));
        if (edited._tag === "Left") {
          if (gone(edited.left)) return { gone: edited.left };
          return yield* Effect.fail(refused(edited.left));
        }
        drawn.set(id, print);
      }
      ids.push(id);
    }
    for (const id of shown.slice(parts.length)) yield* drop(id);
    return { ids };
  });

  return CupChannel.of({
    show: Effect.fn("cupChannel.show")(function* <S extends Slot>(
      slot: S,
      shown: ReadonlyArray<string>,
      view: SlotViews[S],
      options?: ShowOptions,
    ) {
      const parts = yield* draw(slot, view);
      const week = view.week.week;
      if (shown.length === 0) return yield* post(slot, week, parts, ONCE[slot]);
      const redrawn = yield* redraw(slot, week, shown, parts);
      if ("ids" in redrawn) return redrawn.ids;
      if (options?.repost === false) return yield* Effect.fail(refused(redrawn.gone));
      // Someone deleted one: the rest go too, and the slot is posted afresh, without the nonce
      // (which would find the first post again).
      for (const id of shown) yield* drop(id).pipe(Effect.ignore);
      return yield* post(slot, week, parts, false);
    }),
    say: Effect.fn("cupChannel.say")(function* (notice: CupNotice) {
      const message = cupNoticeMessage(notice);
      yield* sink
        .send(
          notice._tag === "CupMaps"
            ? sentOnce(message, guildId, notice.week.week, "cupmaps")
            : message,
        )
        .pipe(Effect.mapError(refused));
    }),
  });
};
