// The test server's channels for `pnpm discord` (AXI style: names in, compact rows out): finding a
// channel by name, listing them, and reading the arguments of `variants` and `ops --since`.

/** The parts of Discord's channel object this reads. */
export interface ApiChannel {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly parent_id?: string | null;
  readonly topic?: string | null;
  readonly last_message_id?: string | null;
  readonly message_count?: number;
  readonly thread_metadata?: { readonly archived: boolean };
}

const KINDS: Record<number, string> = { 0: "text", 5: "news", 15: "forum" };
const CATEGORY = 4;
/** A public thread: what an id the server's list doesn't hold is taken for. */
const THREAD = 11;

/**
 * A channel by id, by name (with or without its #, in any case), or the names it nearly matches.
 * An id the list doesn't hold is taken as it is: threads aren't in the server's channel list.
 */
export const findChannel = (
  ref: string,
  channels: ReadonlyArray<ApiChannel>,
): { channel: ApiChannel } | { missing: string; near: Array<string> } => {
  const byId = channels.find((c) => c.id === ref);
  if (byId !== undefined) return { channel: byId };
  if (/^\d{17,20}$/.test(ref)) return { channel: { id: ref, name: ref, type: THREAD } };
  const want = ref.replace(/^#/, "").toLowerCase();
  const named = channels.filter((c) => c.type !== CATEGORY);
  const hit = named.find((c) => c.name.toLowerCase() === want);
  if (hit !== undefined) return { channel: hit };
  return {
    missing: ref,
    near: named.filter((c) => c.name.toLowerCase().includes(want)).map((c) => c.name),
  };
};

/** When a snowflake id was made, in ms since 1970. */
const timeOf = (id: string) => Number((BigInt(id) >> 22n) + 1420070400000n);

/** How long ago a message id was posted, in its largest whole unit. */
export const ageOf = (id: string | null | undefined, now: number) => {
  if (id === undefined || id === null) return "never";
  const minutes = Math.max(0, Math.floor((now - timeOf(id)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
};

/**
 * Loose: outside every category, where sandboxes, prototypes and design rounds were put, so the
 * channels to tidy. The server's own channels all sit in one.
 */
export const isLoose = (c: ApiChannel) => c.parent_id === undefined || c.parent_id === null;

export interface ChannelRow {
  readonly name: string;
  readonly kind: string;
  /** How long ago its last post was. */
  readonly last: string;
  readonly loose: boolean;
}

/** The channels a message can go in: text, news and forum channels, not categories or voice. */
export const channelRows = (channels: ReadonlyArray<ApiChannel>, now: number): Array<ChannelRow> =>
  channels.flatMap((c) => {
    const kind = KINDS[c.type];
    return kind === undefined
      ? []
      : [{ name: c.name, kind, last: ageOf(c.last_message_id, now), loose: isLoose(c) }];
  });

/** The name Discord gives a new text channel: lower case, spaces as dashes. */
export const channelName = (name: string) =>
  name.replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-");

/** `A=<file or text>` pairs, in order, or the first argument that isn't one. */
export const parseVariants = (
  args: ReadonlyArray<string>,
): { variants: Array<{ label: string; value: string }> } | { bad: string } => {
  if (args.length === 0) return { bad: "" };
  const variants: Array<{ label: string; value: string }> = [];
  for (const arg of args) {
    const m = /^([A-Za-z0-9]{1,12})=(.+)$/s.exec(arg);
    if (m?.[1] === undefined || m[2] === undefined) return { bad: arg };
    variants.push({ label: m[1], value: m[2] });
  }
  return { variants };
};

/** `30m`, `6h` or `2d` in ms; null for anything else. */
export const parseSince = (text: string): number | null => {
  const m = /^(\d+)([mhd])$/.exec(text);
  if (m?.[1] === undefined) return null;
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "m" | "h" | "d"];
};
