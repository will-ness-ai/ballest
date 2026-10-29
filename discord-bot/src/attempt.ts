// One try at something that talks to Discord on a guest Venue's behalf (setting a server up,
// starting its channel), the same way each time: one at a time per key, a time limit that only
// stops the wait, and ops told once per kind of failure.
import { Cause, type Duration, Effect, Exit, Option } from "effect";
import type { Alerts } from "./ops.js";

/**
 * Run `work` unless a try for the same key is still running (none then). It is never interrupted:
 * past `limit` it counts as failed with `onTimeout`'s error, and runs on in the background, the
 * key busy till it ends. A bug in it is logged; ops hears `tell`'s words for a failure, once per
 * key and kind.
 */
export const attempt = Effect.fn("Attempt.run")(function* <A, E, R>(
  work: Effect.Effect<A, E, R>,
  opts: {
    readonly key: string;
    readonly busy: Set<string>;
    readonly limit: Duration.DurationInput;
    readonly onTimeout: () => E;
    readonly alerts: Alerts;
    /** What ops hears of a failure, and its kind; none to say nothing. */
    readonly tell: (
      cause: Cause.Cause<E>,
    ) => Option.Option<{ readonly message: string; readonly kind: string }>;
  },
) {
  if (opts.busy.has(opts.key)) return Option.none<Exit.Exit<A, E>>();
  opts.busy.add(opts.key);
  const tried = yield* Effect.exit(
    work.pipe(
      Effect.ensuring(Effect.sync(() => opts.busy.delete(opts.key))),
      Effect.uninterruptible,
      Effect.disconnect,
      Effect.timeoutFail({ duration: opts.limit, onTimeout: opts.onTimeout }),
    ),
  );
  if (Exit.isFailure(tried)) {
    if (Option.isNone(Cause.failureOption(tried.cause)))
      yield* Effect.logError(`${opts.key} hit a bug`, tried.cause);
    const told = opts.tell(tried.cause);
    if (Option.isSome(told))
      yield* opts.alerts.post(told.value.message, { key: opts.key, kind: told.value.kind });
  }
  return Option.some(tried);
});
