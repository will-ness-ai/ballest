// What a Discord message shows, as compact text for an agent (AXI style: TOON-like rows, the
// few fields that matter, long text cut with a size hint). One reader for both sources: a
// message fetched from Discord's API, and a reply the sandbox driver recorded, turned into the
// same shape by `fromPayload`.

/** The parts of Discord's message object this reads. Components can nest (rows, containers, labels). */
export interface ApiComponent {
  readonly type: number;
  readonly custom_id?: string;
  readonly label?: string | null;
  readonly url?: string;
  readonly style?: number;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly content?: string;
  readonly components?: ReadonlyArray<ApiComponent>;
  readonly component?: ApiComponent;
}

export interface ApiEmbed {
  readonly title?: string;
  readonly description?: string;
  readonly image?: { readonly url: string };
}

export interface ApiMessage {
  readonly id: string;
  readonly author?: { readonly id: string; readonly username: string; readonly bot?: boolean };
  readonly content?: string;
  readonly timestamp?: string;
  readonly embeds?: ReadonlyArray<ApiEmbed>;
  readonly components?: ReadonlyArray<ApiComponent>;
  readonly attachments?: ReadonlyArray<{ readonly filename: string; readonly url?: string }>;
  readonly mentions?: ReadonlyArray<{ readonly id: string; readonly username: string }>;
  /** Who the message actually pings (the payload's allowedMentions), when known. */
  readonly pings?: ReadonlyArray<string>;
  readonly thread?: { readonly id: string; readonly name: string; readonly message_count?: number };
  /** A reply the bot made privately, read back by the sandbox driver rather than from Discord. */
  readonly private?: boolean;
  /** Discord's message type: 0 and 19 (a reply) are ordinary, the rest are system messages. */
  readonly type?: number;
}

const SYSTEM: Record<number, string> = {
  6: "pinned a message",
  18: "thread created",
  21: "thread starter",
};

/**
 * Discord markup as a person sees it: `<@id>` as @name (from the message's mentions), custom
 * emojis as :name:, and timestamps as UTC times. The raw ids stay in `detail`'s mentions line.
 */
export const readable = (text: string, mentions: ApiMessage["mentions"] = []) =>
  text
    .replace(/<@!?(\d+)>/g, (raw, id: string) => {
      const user = mentions.find((u) => u.id === id);
      return user === undefined ? raw : `@${user.username}`;
    })
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/<t:(\d+)(?::([tTdDfFR]))?>/g, (_, unix: string, style?: string) => {
      const at = new Date(Number(unix) * 1000).toISOString().slice(0, 16).replace("T", " ");
      return style === "R" ? `(${at}Z, relative)` : `${at}Z`;
    });

/** Why a message shows nothing: a system message, or text the reading app isn't allowed to see. */
const emptyReason = (m: ApiMessage) =>
  m.private === true
    ? "(nothing: an acknowledgement, the answer follows)"
    : m.type !== undefined && m.type !== 0 && m.type !== 19
      ? `(system: ${SYSTEM[m.type] ?? `type ${m.type}`})`
      : "(nothing visible: another app's message needs the reader's Message Content intent)";

const BUTTON = 2;
const TEXT_INPUT = 4;
const TEXT_DISPLAY = 10;
const SELECTS = new Set([3, 5, 6, 7, 8]);
const SELECT_KIND: Record<number, string> = {
  3: "string",
  5: "user",
  6: "role",
  7: "mentionable",
  8: "channel",
};
const STYLE: Record<number, string> = {
  1: "primary",
  2: "secondary",
  3: "success",
  4: "danger",
  5: "link",
  6: "premium",
};

export interface Control {
  readonly kind: "button" | "link" | "select" | "input";
  readonly label: string;
  /** The custom id to press, or the URL a link opens. */
  readonly target: string;
  readonly style: string;
  readonly disabled: boolean;
}

/** Every control in a message, in reading order, however deeply its rows nest. */
export const controlsOf = (components: ReadonlyArray<ApiComponent> = []): Array<Control> =>
  components.flatMap((c): Array<Control> => {
    const inner = [
      ...controlsOf(c.components),
      ...(c.component === undefined ? [] : controlsOf([c.component])),
    ];
    if (c.type === BUTTON) {
      const link = c.url !== undefined;
      return [
        {
          kind: link ? "link" : "button",
          label: c.label ?? "",
          target: link ? (c.url ?? "") : (c.custom_id ?? ""),
          style: STYLE[c.style ?? 0] ?? String(c.style),
          disabled: c.disabled === true,
        },
      ];
    }
    if (SELECTS.has(c.type))
      return [
        {
          kind: "select",
          label: c.placeholder ?? "",
          target: c.custom_id ?? "",
          style: SELECT_KIND[c.type] ?? "",
          disabled: c.disabled === true,
        },
      ];
    if (c.type === TEXT_INPUT)
      return [
        {
          kind: "input",
          label: c.label ?? "",
          target: c.custom_id ?? "",
          style: "text",
          disabled: false,
        },
      ];
    return inner;
  });

/** Text shown by components (Components V2 text displays), in reading order. */
const textsOf = (components: ReadonlyArray<ApiComponent> = []): Array<string> =>
  components.flatMap((c) => [
    ...(c.type === TEXT_DISPLAY && c.content !== undefined ? [c.content] : []),
    ...textsOf(c.components),
    ...(c.component === undefined ? [] : textsOf([c.component])),
  ]);

/** A value for a TOON row: quoted when it would break the row. */
export const cell = (v: string | number | boolean) => {
  const s = String(v);
  return /[,"\n]|^\s|\s$/.test(s) || s === "" ? JSON.stringify(s) : s;
};

export const cut = (text: string, limit: number) =>
  text.length <= limit
    ? text
    : `${text.slice(0, limit)}… (truncated, ${text.length} chars total; use --full)`;

/** One message in one line: for lists. */
export const summary = (m: ApiMessage, limit = 80): string => {
  const parts: Array<string> = [];
  const text = [
    readable(m.content ?? "", m.mentions),
    ...(m.embeds ?? []).map((e) => [e.title, e.description].filter(Boolean).join(": ")),
    ...textsOf(m.components),
  ]
    .filter((t) => t !== "")
    .join(" | ")
    .replace(/\s+/g, " ");
  if (text !== "") parts.push(cut(text, limit).replace(/ \(truncated.*$/, "…"));
  const images = (m.attachments ?? []).length;
  if (images > 0) parts.push(`[${images} file${images === 1 ? "" : "s"}]`);
  const controls = controlsOf(m.components).filter((c) => c.kind !== "input");
  if (controls.length > 0)
    parts.push(`[${controls.map((c) => c.label + (c.disabled ? " (off)" : "")).join(" | ")}]`);
  if (m.thread !== undefined) parts.push(`[thread ${m.thread.id}]`);
  return parts.length === 0 ? emptyReason(m) : parts.join(" ");
};

/** A table in TOON: `name[n]{a,b}:` then one indented row per item, or a definitive empty line. */
export const table = (
  name: string,
  fields: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean>>,
) =>
  rows.length === 0
    ? [`${name}: none`]
    : [
        `${name}[${rows.length}]{${fields.join(",")}}:`,
        ...rows.map((r) => `  ${r.map(cell).join(",")}`),
      ];

/** Everything a message shows. `files` maps an attachment's name to where it was saved locally. */
/** Continuation lines of a multi-line value, indented under their label. */
const indent = (text: string) => text.replace(/\n/g, "\n  ");

export const detail = (
  m: ApiMessage,
  opts: { readonly full?: boolean; readonly files?: ReadonlyMap<string, string> } = {},
): Array<string> => {
  const limit = opts.full === true ? Number.POSITIVE_INFINITY : 600;
  const lines: Array<string> = [
    `message: ${m.id}${m.author === undefined ? "" : ` by ${m.author.username}`}${m.timestamp === undefined ? "" : ` at ${m.timestamp}`}`,
  ];
  if ((m.content ?? "") !== "")
    lines.push(`content: ${indent(cut(readable(m.content ?? "", m.mentions), limit))}`);
  for (const t of textsOf(m.components)) lines.push(`text: ${indent(cut(t, limit))}`);
  for (const e of m.embeds ?? []) {
    const body = [e.title === undefined ? null : `**${e.title}**`, e.description ?? null]
      .filter((x) => x !== null)
      .join(" ");
    lines.push(`embed: ${indent(cut(body, limit))}`);
  }
  const files = (m.attachments ?? []).map(
    (a) => [a.filename, opts.files?.get(a.filename) ?? a.url ?? "(not saved)"] as const,
  );
  lines.push(...table("files", ["name", "path"], files));
  const controls = controlsOf(m.components);
  lines.push(
    ...table(
      "controls",
      ["kind", "label", "id", "style", "disabled"],
      controls.map((c) => [c.kind, c.label, c.target, c.style, c.disabled]),
    ),
  );
  if (m.pings !== undefined)
    lines.push(`pings: ${m.pings.length === 0 ? "nobody" : m.pings.join(" ")}`);
  else if ((m.mentions ?? []).length > 0)
    lines.push(`mentions: ${(m.mentions ?? []).map((u) => `${u.username} (${u.id})`).join(", ")}`);
  if (m.thread !== undefined)
    lines.push(
      `thread: ${m.thread.id} ${cell(m.thread.name)}${m.thread.message_count === undefined ? "" : ` (${m.thread.message_count} messages)`}`,
    );
  const shows =
    (m.content ?? "") !== "" || textsOf(m.components).length > 0 || (m.embeds ?? []).length > 0;
  if (!shows && files.length === 0 && controls.length === 0) lines.push(`shows: ${emptyReason(m)}`);
  return lines;
};

// ---------------------------------------------------------------- payloads the bot sent privately

interface Jsonable {
  toJSON(): unknown;
}
const json = (x: unknown): unknown =>
  typeof x === "object" && x !== null && "toJSON" in x ? (x as Jsonable).toJSON() : x;

/** A file in a discord.js payload: an AttachmentBuilder, or `{ attachment, name }`. */
export interface PayloadFile {
  readonly name: string;
  readonly data: Buffer | null;
}

export const filesOf = (payload: Record<string, unknown>): Array<PayloadFile> =>
  ((payload.files as ReadonlyArray<unknown> | undefined) ?? []).map((f, i) => {
    const o = f as { name?: string | null; attachment?: unknown };
    return {
      name: o.name ?? `file-${i}`,
      data: Buffer.isBuffer(o.attachment) ? o.attachment : null,
    };
  });

/**
 * Who a payload pings: discord.js parses every mention unless `allowedMentions` narrows it.
 * Only explicit user lists and an empty parse are read; anything else reads as "default".
 */
const pingsOf = (payload: Record<string, unknown>): ReadonlyArray<string> | undefined => {
  const allowed = payload.allowedMentions as
    { parse?: ReadonlyArray<string>; users?: ReadonlyArray<string> } | undefined;
  if (allowed === undefined) return undefined;
  return [
    ...(allowed.users ?? []).map((u) => `<@${u}>`),
    ...(allowed.parse ?? []).map((p) => `@${p}`),
  ];
};

/** A discord.js payload (reply, update, followUp) in Discord's own message shape, so `detail` reads it. */
export const fromPayload = (id: string, payload: unknown): ApiMessage => {
  if (typeof payload === "string") return { id, private: true, content: payload };
  const p = (json(payload) ?? {}) as Record<string, unknown>;
  // A modal: its title, then its inputs as controls.
  if (typeof p.custom_id === "string" && typeof p.title === "string")
    return {
      id,
      private: true,
      content: `modal ${p.custom_id}: ${p.title}`,
      components: (p.components as ReadonlyArray<ApiComponent> | undefined) ?? [],
    };
  const pings = pingsOf(p);
  return {
    id,
    private: true,
    content: typeof p.content === "string" ? p.content : "",
    embeds: ((p.embeds as ReadonlyArray<unknown> | undefined) ?? []).map(
      (e) => json(e) as ApiEmbed,
    ),
    components: ((p.components as ReadonlyArray<unknown> | undefined) ?? []).map(
      (c) => json(c) as ApiComponent,
    ),
    attachments: filesOf(p).map((f) => ({ filename: f.name })),
    ...(pings === undefined ? {} : { pings }),
  };
};
