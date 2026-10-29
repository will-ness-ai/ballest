// `pnpm --silent discord`: the test server, for agents. It follows the `agent-tools` skill (AXI style:
// live data first, compact rows, a next step after every answer, errors on stdout). It works as
// the Admin app (ADMIN_DISCORD_TOKEN in the dev .env): reads and posts in any channel by name,
// makes and removes channels and webhooks, reads #ops, and runs and drives the sandbox bot
// (`pnpm sandbox`) through its local driver: pressing buttons, picking, submitting forms as any
// member, and setting fake Steam times.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, posix } from "node:path";
import { ChannelType, OverwriteType, PermissionFlagsBits, REST, Routes } from "discord.js";
import {
  type ApiMessage,
  attachmentsOf,
  cell,
  controlsOf,
  detail,
  summary,
  table,
} from "./discord/describe.js";
import {
  type ApiChannel,
  ageOf,
  channelName,
  channelRows,
  findChannel,
  isLoose,
  parseSince,
  parseVariants,
} from "./discord/server.js";
import { devEnvFile } from "./devEnv.js";
import type { Answer } from "./sandbox/driver.js";
import { DRIVER_PORT, LOGS, readSandbox, writeSandbox } from "./sandbox/config.js";

// ---------------------------------------------------------------- setup

const say = (lines: ReadonlyArray<string> | string) =>
  console.log(typeof lines === "string" ? lines : lines.join("\n"));
const fail = (message: string, help: ReadonlyArray<string> = []): never => {
  say([`error: ${message}`, ...helpLines(help)]);
  process.exit(1);
};
/** A usage error: exit 2, as for an unknown command or flag. */
const usage = (message: string, help: ReadonlyArray<string> = []): never => {
  say([`error: ${message}`, ...helpLines(help)]);
  process.exit(2);
};
const helpLines = (help: ReadonlyArray<string>) =>
  help.length === 0 ? [] : [`help[${help.length}]:`, ...help.map((h) => `  ${h}`)];

const readEnv = (file: string): Record<string, string> => {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m?.[1] !== undefined) out[m[1]] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
};
const env = { ...readEnv(devEnvFile()), ...process.env } as Record<string, string | undefined>;
const guildId = env.DISCORD_GUILD_ID ?? fail("DISCORD_GUILD_ID is not set (dev .env)");
const adminToken = env.ADMIN_DISCORD_TOKEN;
/** Without the Admin app, the dev bot's own token reads (its own messages only, and no sandbox setup). */
const token =
  adminToken ??
  env.DISCORD_TOKEN ??
  fail("neither ADMIN_DISCORD_TOKEN nor DISCORD_TOKEN is set (dev .env)");
const asAdmin = adminToken !== undefined;
const rest = new REST({ version: "10" }).setToken(token);

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
/** Every value of a flag that may repeat (`--file a --file b`). */
const flags = (name: string) => {
  const out: Array<string> = [];
  for (let v = flag(name); v !== undefined; v = flag(name)) out.push(v);
  return out;
};
const has = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};

const OUT_DIR = posix.join(LOGS, "discord");
const LAST_REPLY = posix.join(OUT_DIR, "last-reply.json");

const call = async <T>(what: string, run: () => Promise<unknown>): Promise<T> => {
  try {
    return (await run()) as T;
  } catch (e) {
    const code = typeof e === "object" && e !== null && "code" in e ? ` [${String(e.code)}]` : "";
    // No answer at all: this machine can't reach Discord, which is a different next step.
    if (
      /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET/.test(String(e)) ||
      code === " [ENOTFOUND]"
    )
      return fail(`${what}: discord.com didn't answer from ${hostname()}`, [
        "run it on a machine that reaches Discord (Will's PC, through Remote Control)",
      ]);
    return fail(`${what}: ${e instanceof Error ? e.message : String(e)}${code}`);
  }
};

const sandbox = readSandbox();
const sandboxChannel = () =>
  sandbox?.channelId ?? fail("no sandbox channel yet", ["pnpm --silent discord sandbox create"]);

let channelList: ReadonlyArray<ApiChannel> | undefined;
const serverChannels = async () =>
  (channelList ??= await call<ReadonlyArray<ApiChannel>>("list channels", () =>
    rest.get(Routes.guildChannels(guildId)),
  ));
/** A channel by name or id; a thread by id. */
const channelOf = async (ref: string): Promise<ApiChannel> => {
  const found = findChannel(ref, /^\d{17,20}$/.test(ref) ? [] : await serverChannels());
  if ("channel" in found) return found.channel;
  return fail(
    `no channel named "${found.missing}"${found.near.length === 0 ? "" : ` (near: ${found.near.join(", ")})`}`,
    ["pnpm --silent discord channels"],
  );
};
/** The channel a command reads: the one named, or the sandbox. */
const channelOrSandbox = async (ref: string | undefined) =>
  ref === undefined ? sandboxChannel() : (await channelOf(ref)).id;
/** How a later command names this channel: by name where it has one, the sandbox by nothing. */
/** A channel as a command takes it: by name where it has one (a thread has only its id). */
const label = (c: ApiChannel | string) =>
  typeof c === "string" || c.name === c.id ? (typeof c === "string" ? c : c.id) : `#${c.name}`;
const inFlag = (c: ApiChannel | string) => {
  const id = typeof c === "string" ? c : c.id;
  return id === sandbox?.channelId ? "" : ` --in ${label(c).replace(/^#/, "")}`;
};
const link = (channelId: string, messageId: string) =>
  `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

interface ApiMember {
  readonly user: { readonly id: string; readonly username: string; readonly bot?: boolean };
  readonly nick?: string | null;
}

const me = () => call<{ id: string; username: string }>("who am I", () => rest.get(Routes.user()));

/** A member by id, "admin", or name. */
const resolveMember = async (who: string | undefined): Promise<string> => {
  if (who === undefined)
    return fail("--as <member> is required", ["pnpm --silent discord members"]);
  if (/^\d+$/.test(who)) return who;
  if (who === "admin") return (await me()).id;
  const found = await call<ReadonlyArray<ApiMember>>("search members", () =>
    rest.get(Routes.guildMembersSearch(guildId), {
      query: new URLSearchParams({ query: who, limit: "5" }),
    }),
  );
  const exact = found.filter((m) =>
    [m.user.username, m.nick].some((n) => n?.toLowerCase() === who.toLowerCase()),
  );
  const pick = exact[0] ?? (found.length === 1 ? found[0] : undefined);
  if (pick === undefined)
    return fail(`no single member matches "${who}" (${found.length} found)`, [
      "pnpm --silent discord members " + who,
    ]);
  return pick.user.id;
};

const messages = (channelId: string, limit: number) =>
  call<ReadonlyArray<ApiMessage>>("read messages", () =>
    rest.get(Routes.channelMessages(channelId), {
      query: new URLSearchParams({ limit: String(limit) }),
    }),
  ).then((ms) => [...ms].reverse());

const driver = async <T>(path: string, body?: unknown): Promise<T> => {
  try {
    const res = await fetch(`http://127.0.0.1:${DRIVER_PORT}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await res.json()) as T;
  } catch {
    return fail(`the sandbox bot isn't running (no driver on port ${DRIVER_PORT})`, [
      "pnpm --silent discord sandbox start",
    ]);
  }
};

interface Health {
  readonly channelId: string;
  readonly matches: ReadonlyArray<{
    id: string;
    state: string;
    type: string;
    players: ReadonlyArray<string>;
    map: string | null;
  }>;
}
const health = async (): Promise<Health | null> => {
  try {
    const res = await fetch(`http://127.0.0.1:${DRIVER_PORT}/health`);
    return (await res.json()) as Health;
  } catch {
    return null;
  }
};

/** Save a message's attachments under .logs/discord; name to path. */
const saveFiles = async (m: ApiMessage) => {
  const files = new Map<string, string>();
  for (const a of attachmentsOf(m)) {
    if (a.url === undefined) continue;
    mkdirSync(OUT_DIR, { recursive: true });
    const path = posix.join(OUT_DIR, `${m.id}-${a.filename}`);
    // Always fetched: an edited Card keeps its message id and file name but not its picture.
    // Discord's media host refuses some clients without a browser-like user agent (a 403).
    const res = await fetch(a.url, { headers: { "user-agent": "Mozilla/5.0 (pnpm discord)" } });
    if (!res.ok) continue;
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    files.set(a.filename, path);
  }
  return files;
};

const rows = (ms: ReadonlyArray<ApiMessage>, full: boolean) =>
  table(
    "messages",
    ["id", "author", "shows"],
    ms.map((m) => [m.id, m.author?.username ?? "?", summary(m, full ? 2000 : 80)]),
  );

// ---------------------------------------------------------------- commands

const home = async () => {
  const self = await me();
  const all = await serverChannels();
  const ops = all.find((c) => c.name === "ops");
  const listed = channelRows(all, Date.now());
  const opsAge = ageOf(ops?.last_message_id, Date.now());
  const lines = [
    "pnpm --silent discord: the Multiballs test server, for agents",
    `as: ${self.username}${asAdmin ? " (Admin app)" : " (dev bot's token: read-only, no ADMIN_DISCORD_TOKEN)"}, from ${hostname()}`,
    `channels: ${listed.length}, ${listed.filter((r) => r.loose).length} loose`,
    `ops: last post ${opsAge}${opsAge === "never" ? "" : " ago"}`,
  ];
  if (sandbox === null) {
    say([
      ...lines,
      "sandbox: none",
      ...helpLines([
        "pnpm --silent discord sandbox create",
        "pnpm --silent discord ops",
        "pnpm --silent discord channels",
      ]),
    ]);
    return;
  }
  lines.push(`sandbox: #${sandbox.channelName} (${sandbox.channelId})`);
  const h = await health();
  lines.push(`bot: ${h === null ? "not running" : "running"}`);
  if (h !== null)
    lines.push(
      ...table(
        "matches",
        ["id", "state", "type", "players", "map"],
        h.matches.map((m) => [m.id, m.state, m.type, m.players.join(" "), m.map ?? "-"]),
      ),
    );
  lines.push(...rows(await messages(sandbox.channelId, 5), false));
  say([
    ...lines,
    ...helpLines([
      ...(h === null ? ["pnpm --silent discord sandbox start"] : []),
      "pnpm --silent discord show <message>",
      "pnpm --silent discord press <label|custom id> --as <member>",
    ]),
  ]);
};

const read = async () => {
  // Flags first: they come out of args, so the channel is whatever positional is left.
  const limit = Number(flag("limit") ?? 10);
  const full = has("full");
  const ref = flag("in") ?? args[0];
  const where = ref === undefined ? sandboxChannel() : await channelOf(ref);
  const id = typeof where === "string" ? where : where.id;
  const ms = await messages(id, limit);
  say([
    `channel: ${label(where)}`,
    ...rows(ms, full),
    ...helpLines([`pnpm --silent discord show <id>${inFlag(where)}`]),
  ]);
};

const show = async () => {
  const where = await channelOrSandbox(flag("in"));
  const full = has("full");
  const id = args[0] ?? usage("show needs a message id", ["pnpm --silent discord read"]);
  const m = await call<ApiMessage>("fetch message", () =>
    rest.get(Routes.channelMessage(where, id)),
  );
  const files = await saveFiles(m);
  const buttons = controlsOf(m.components).filter((c) => c.kind === "button" && !c.disabled);
  say([
    ...detail(m, { full, files }),
    ...helpLines([
      ...(files.size > 0 ? ["Read the saved image to see it"] : []),
      ...(buttons.length > 0
        ? [`pnpm --silent discord press ${cell(buttons[0]?.target ?? "")} --as <member>`]
        : []),
      ...(m.thread === undefined ? [] : [`pnpm --silent discord read ${m.thread.id}`]),
    ]),
  ]);
};

const threads = async () => {
  const parent = sandboxChannel();
  const active = await call<{ threads: ReadonlyArray<ApiChannel> }>("active threads", () =>
    rest.get(Routes.guildActiveThreads(guildId)),
  );
  const archived = await call<{ threads: ReadonlyArray<ApiChannel> }>("archived threads", () =>
    rest.get(Routes.channelThreads(parent, "public")),
  );
  const all = [...active.threads.filter((t) => t.parent_id === parent), ...archived.threads];
  say([
    ...table(
      "threads",
      ["id", "name", "messages", "archived"],
      all.map((t) => [t.id, t.name, t.message_count ?? 0, t.thread_metadata?.archived ?? false]),
    ),
    ...helpLines(["pnpm --silent discord read <thread id>"]),
  ]);
};

const members = async () => {
  const q = args[0];
  const found = await call<ReadonlyArray<ApiMember>>("list members", () =>
    q === undefined
      ? rest.get(Routes.guildMembers(guildId), { query: new URLSearchParams({ limit: "100" }) })
      : rest.get(Routes.guildMembersSearch(guildId), {
          query: new URLSearchParams({ query: q, limit: "25" }),
        }),
  );
  say(
    table(
      "members",
      ["id", "name", "nick", "bot"],
      found.map((m) => [m.user.id, m.user.username, m.nick ?? "", m.user.bot === true]),
    ),
  );
};

/** Print what the bot answered privately, and remember it so its buttons can be pressed by label. */
const answered = (answers: ReadonlyArray<Answer>, follow: ReadonlyArray<string>) => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    LAST_REPLY,
    JSON.stringify(answers.flatMap((a) => (a.message === null ? [] : [a.message]))),
  );
  const lines: Array<string> =
    answers.length === 0
      ? [
          "answers: none (the bot made no call on the interaction within 5 s; check .logs/sandbox.log)",
        ]
      : [`answers[${answers.length}]:`];
  for (const a of answers) {
    lines.push(`  ${a.method}${a.message === null ? "" : ":"}`);
    if (a.message !== null)
      lines.push(
        ...detail(a.message, { files: new Map(Object.entries(a.files)) })
          .slice(1)
          .map((l) => `    ${l}`),
      );
  }
  // A form opened: say how to fill it in, with its inputs' ids.
  const form = answers.find((a) => a.message?.content?.startsWith("modal ") === true)?.message;
  const formHelp =
    form === undefined || form === null
      ? []
      : [
          `pnpm --silent discord submit ${form.content?.split(" ")[1]?.replace(/:$/, "") ?? "<form id>"} ${controlsOf(
            form.components,
          )
            .filter((c) => c.kind === "input")
            .map((c) => `${c.target}=<value>`)
            .join(" ")} --as <member>`,
        ];
  say([...lines, ...helpLines([...formHelp, ...follow])]);
};

/** The sandbox's active Match Threads, newest first. */
const sandboxThreads = async () => {
  const parent = sandboxChannel();
  const active = await call<{ threads: ReadonlyArray<ApiChannel> }>("active threads", () =>
    rest.get(Routes.guildActiveThreads(guildId)),
  );
  return active.threads
    .filter((t) => t.parent_id === parent)
    .sort((x, y) => (BigInt(y.id) > BigInt(x.id) ? 1 : -1));
};

/** A message in the sandbox channel or one of its active Match Threads. */
const sandboxMessage = async (id: string): Promise<ApiMessage> => {
  for (const where of [sandboxChannel(), ...(await sandboxThreads()).map((t) => t.id)]) {
    try {
      return (await rest.get(Routes.channelMessage(where, id))) as ApiMessage;
    } catch (e) {
      // Not in this one: Discord answers Unknown Message (10008) for a message in another channel.
      const code = typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
      // Anything else (a 403, the network) is asked once more through `call`, which says what it is.
      if (code !== 10008)
        return call<ApiMessage>("fetch message", () => rest.get(Routes.channelMessage(where, id)));
    }
  }
  return fail(`no message ${id} in the sandbox or its active Match Threads`, [
    "pnpm --silent discord threads",
  ]);
};

/**
 * A custom id, or a button's label looked up in the given message, the last private reply, the
 * newest channel messages, or the newest posts in its active Match Threads.
 */
const resolveControl = async (target: string, messageId: string | undefined) => {
  if (target.startsWith("mb:")) return target;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s*\(\d+\)$/, "")
      .trim();
  const find = (pool: ReadonlyArray<ApiMessage>) => {
    for (const m of pool) {
      const hit = controlsOf(m.components).find(
        (c) => c.kind !== "link" && norm(c.label) === norm(target),
      );
      if (hit !== undefined) return hit.target;
    }
    return undefined;
  };
  if (messageId !== undefined) {
    const hit = find([await sandboxMessage(messageId)]);
    if (hit !== undefined) return hit;
  } else {
    if (existsSync(LAST_REPLY)) {
      const hit = find(JSON.parse(readFileSync(LAST_REPLY, "utf8")) as ReadonlyArray<ApiMessage>);
      if (hit !== undefined) return hit;
    }
    const hit = find((await messages(sandboxChannel(), 10)).reverse());
    if (hit !== undefined) return hit;
    for (const t of await sandboxThreads()) {
      const inThread = find((await messages(t.id, 10)).reverse());
      if (inThread !== undefined) return inThread;
    }
  }
  return fail(
    `no button labelled "${target}" in ${messageId === undefined ? "the last private reply, the newest messages or the active Match Threads" : `message ${messageId}`}`,
    ["pnpm --silent discord read", "pnpm --silent discord show <message>"],
  );
};

const FOLLOW = [
  "pnpm --silent discord read",
  "pnpm --silent discord press <label|custom id> --as <member>",
];

const press = async () => {
  const messageId = flag("message");
  const as = await resolveMember(flag("as"));
  const customId = await resolveControl(
    args[0] ?? fail("press needs a label or custom id"),
    messageId,
  );
  const { answers } = await driver<{ answers: ReadonlyArray<Answer> }>("/interact", {
    kind: "button",
    customId,
    as,
  });
  answered(answers, FOLLOW);
};

const pick = async () => {
  const as = await resolveMember(flag("as"));
  const [customId, ...picked] = args;
  if (customId === undefined || picked.length === 0)
    return fail("pick needs a custom id and at least one value");
  const values = await Promise.all(picked.map((v) => resolveMember(v)));
  const { answers } = await driver<{ answers: ReadonlyArray<Answer> }>("/interact", {
    kind: "select",
    customId,
    as,
    values,
  });
  answered(answers, FOLLOW);
};

const submit = async () => {
  const as = await resolveMember(flag("as"));
  const [customId, ...pairs] = args;
  if (customId === undefined) return fail("submit needs a custom id and field=value pairs");
  const fields = Object.fromEntries(
    pairs.map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]),
  );
  const { answers } = await driver<{ answers: ReadonlyArray<Answer> }>("/interact", {
    kind: "modal",
    customId,
    as,
    fields,
  });
  answered(answers, FOLLOW);
};

const time = async () => {
  const as = await resolveMember(flag("as"));
  const [matchId, seconds] = args;
  if (matchId === undefined || seconds === undefined)
    return fail("time needs a Match id and seconds");
  const out = await driver<{ ok?: string; error?: string }>("/time", {
    matchId,
    as,
    seconds: Number(seconds),
  });
  if (out.error !== undefined) return fail(out.error, ["pnpm --silent discord"]);
  say([
    out.ok ?? "",
    ...helpLines([
      "pnpm --silent discord wait improved --in <thread>   (an improvement post is improved.png)",
    ]),
  ]);
};

const runCmd = async () => {
  const as = await resolveMember(flag("as"));
  const [map, seconds] = args;
  if (map === undefined || seconds === undefined) return fail("run needs a Map and seconds");
  const out = await driver<{ ok?: string; error?: string }>("/run", {
    map,
    as,
    seconds: Number(seconds),
  });
  if (out.error !== undefined) return fail(out.error, ["pnpm --silent discord"]);
  say([
    out.ok ?? "",
    ...helpLines(["pnpm --silent discord read <#weekly-cup id>   (the Cup reads every 5 minutes)"]),
  ]);
};

const clockCmd = async () => {
  const to = args[0];
  const out =
    to === undefined
      ? await driver<{ now?: string; error?: string }>("/clock")
      : await driver<{ now?: string; error?: string }>("/clock", { to });
  if (out.error !== undefined) return fail(out.error);
  say([`now: ${out.now ?? ""}`]);
};

const steamCmd = async () => {
  const state = args[0];
  if (state !== "down" && state !== "up") return fail("steam needs down or up");
  const out = await driver<{ ok?: string; error?: string }>("/steam", { down: state === "down" });
  if (out.error !== undefined) return fail(out.error, ["pnpm --silent discord"]);
  say([
    out.ok ?? "",
    ...helpLines(
      state === "down"
        ? ['pnpm --silent discord wait "Time\'s up" --in <thread>   (when a Match ends while down)']
        : ['pnpm --silent discord wait "Final result" --in <thread>'],
    ),
  ]);
};

const wait = async () => {
  const where = await channelOrSandbox(flag("in"));
  const timeout = Number(flag("timeout") ?? 30) * 1000;
  const text = args[0] ?? usage('wait needs the text to wait for ("" for any new message)');
  const seen = new Set((await messages(where, 20)).map((m) => m.id));
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    // Text, or an image's file name: a post can be an image alone (an improvement is improved.png).
    const shown = (m: ApiMessage) =>
      [summary(m, 2000), ...(m.attachments ?? []).map((a) => a.filename)].join(" ").toLowerCase();
    const hit = (await messages(where, 20)).find(
      (m) => !seen.has(m.id) && shown(m).includes(text.toLowerCase()),
    );
    if (hit !== undefined)
      return say([
        ...detail(hit, { files: await saveFiles(hit) }),
        ...helpLines([`pnpm --silent discord show ${hit.id}${inFlag(where)}`]),
      ]);
  }
  return fail(`no new message containing "${text}" in ${timeout / 1000} s`, [
    `pnpm --silent discord read ${where}`,
  ]);
};

const PID_FILE = posix.join(LOGS, "sandbox.pid");
const SANDBOX_LOG = posix.join(LOGS, "sandbox.log");
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** The sandbox bot this checkout started, if it still runs: a crash leaves a pid a later process may reuse. */
const runningPid = () => {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return null;
  const cmdline = `/proc/${pid}/cmdline`;
  return !existsSync(cmdline) || readFileSync(cmdline, "utf8").includes("sandbox.ts") ? pid : null;
};
const tail = (file: string, n: number) =>
  existsSync(file) ? readFileSync(file, "utf8").trimEnd().split(/\r?\n/).slice(-n) : [];

/** Start `pnpm sandbox` in the background and return once the bot has logged in and the driver is on. */
const sandboxStart = async () => {
  const cup = has("cup");
  const keep = has("keep");
  sandboxChannel();
  const pid = runningPid();
  if (pid !== null || (await health()) !== null)
    return say([
      `bot: running${pid === null ? " (started elsewhere)" : ` (pid ${pid})`} (no-op)`,
      ...helpLines(["pnpm --silent discord", "pnpm --silent discord sandbox stop"]),
    ]);
  mkdirSync(LOGS, { recursive: true });
  // Emptied here, not only by the bot once it loads: the last run's log says it logged in.
  writeFileSync(SANDBOX_LOG, "");
  const out = openSync(posix.join(LOGS, "sandbox.out"), "w");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/sandbox.ts",
      ...(cup ? ["--cup"] : []),
      ...(keep ? ["--keep"] : []),
    ],
    { detached: true, stdio: ["ignore", out, out], windowsHide: true },
  );
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  const started = Date.now();
  // Both: the driver comes up before the bot's Discord login, and a press before the login is lost.
  const ready = () => {
    const log = existsSync(SANDBOX_LOG) ? readFileSync(SANDBOX_LOG, "utf8") : "";
    return log.includes("sandbox driver on") && log.includes("logged in as");
  };
  while (Date.now() - started < 90_000) {
    await new Promise((r) => setTimeout(r, 1000));
    if (child.pid === undefined || !alive(child.pid))
      return fail("the sandbox bot stopped while starting", [
        ...tail(posix.join(LOGS, "sandbox.out"), 5).map((l) => `(out) ${l}`),
        `less ${SANDBOX_LOG}`,
      ]);
    if (ready())
      return say([
        `bot: running (pid ${child.pid}), ready in ${Math.round((Date.now() - started) / 1000)} s${cup ? ", Weekly Cup on" : ""}`,
        ...helpLines([
          'pnpm --silent discord press "New Match" --as admin',
          "pnpm --silent discord",
          "pnpm --silent discord sandbox stop",
        ]),
      ]);
  }
  return fail("the sandbox bot didn't log in within 90 s", [
    ...tail(SANDBOX_LOG, 5).map((l) => `(log) ${l}`),
    "pnpm --silent discord sandbox stop",
  ]);
};

const sandboxStop = () => {
  const pid = runningPid();
  if (pid === null)
    return say([
      "bot: not running (no-op)",
      ...helpLines(["pnpm --silent discord sandbox delete"]),
    ]);
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/t", "/f"]);
    // The whole group: its children die with it.
    else process.kill(-pid, "SIGTERM");
  } catch {
    // Gone since runningPid looked: the no-op it would have been.
  }
  writeFileSync(PID_FILE, "");
  return say([`bot: stopped (pid ${pid})`, ...helpLines(["pnpm --silent discord sandbox delete"])]);
};

const sandboxCmd = async () => {
  const sub = args[0];
  if (sub === "start") return sandboxStart();
  if (sub === "stop") return sandboxStop();
  needAdmin("making channels");
  if (sub === "create") {
    if (sandbox !== null)
      return fail(`a sandbox already exists: #${sandbox.channelName}`, [
        "pnpm --silent discord sandbox delete",
      ]);
    const botId =
      env.DISCORD_APPLICATION_ID ??
      fail("DISCORD_APPLICATION_ID (the dev bot's id) is not set in the dev .env");
    const name =
      args[1] ?? `sandbox-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "")}`;
    const everyone = guildId;
    const created = await call<ApiChannel>("create channel", () =>
      rest.post(Routes.guildChannels(guildId), {
        body: {
          name,
          type: ChannelType.GuildText,
          topic: "Multiballs sandbox for agents (pnpm --silent discord). Safe to delete.",
          permission_overwrites: [
            {
              id: everyone,
              type: OverwriteType.Role,
              deny: String(PermissionFlagsBits.SendMessages),
            },
            {
              id: botId,
              type: OverwriteType.Member,
              allow: String(
                PermissionFlagsBits.ViewChannel |
                  PermissionFlagsBits.SendMessages |
                  PermissionFlagsBits.EmbedLinks |
                  PermissionFlagsBits.AttachFiles |
                  PermissionFlagsBits.ReadMessageHistory |
                  PermissionFlagsBits.CreatePublicThreads |
                  PermissionFlagsBits.SendMessagesInThreads |
                  PermissionFlagsBits.ManageThreads,
              ),
            },
          ],
        },
      }),
    );
    writeSandbox({ guildId, channelId: created.id, channelName: created.name });
    return say([
      `created: #${created.name} (${created.id})`,
      ...helpLines(["pnpm --silent discord sandbox start", "pnpm --silent discord"]),
    ]);
  }
  if (sub === "delete") {
    // An id deletes a sandbox this checkout didn't make (another worktree's, say).
    const channelId = args[1] ?? sandboxChannel();
    const gone = await call<ApiChannel>("delete channel", () =>
      rest.delete(Routes.channel(channelId)),
    );
    if (channelId === sandbox?.channelId) writeSandbox(null);
    return say([`deleted: #${gone.name}`, ...helpLines(["pnpm --silent discord sandbox create"])]);
  }
  return usage(`unknown sandbox command "${sub ?? ""}"`, [
    "pnpm --silent discord sandbox create",
    "pnpm --silent discord sandbox start",
    "pnpm --silent discord sandbox stop",
    "pnpm --silent discord sandbox delete",
  ]);
};

// ---------------------------------------------------------------- the server's channels

const LOOSE_TOPIC = "Made by pnpm discord for agents. Safe to delete.";

/** Posting and making things are the Admin app's: the dev bot's token would post as the bot. */
const needAdmin = (what: string) => {
  if (!asAdmin) fail(`${what} needs the Admin app: set ADMIN_DISCORD_TOKEN in the dev .env`);
};

const channelsCmd = async () => {
  const all = await serverChannels();
  const rows = channelRows(all, Date.now());
  const loose = rows.filter((r) => r.loose).length;
  say([
    ...table(
      "channels",
      ["name", "kind", "last", "loose"],
      rows.map((r) => [r.name, r.kind, r.last, r.loose]),
    ),
    `count: ${rows.length}, ${loose} loose (outside every category: sandboxes, prototypes, design rounds)`,
    ...helpLines([
      "pnpm --silent discord read <name>",
      "pnpm --silent discord channel delete <loose name>",
      "pnpm --silent discord channel create <name>",
    ]),
  ]);
};

const channelCmd = async () => {
  // Flags first: they come out of args, so the name is whatever positional is left.
  const force = has("force");
  const topic = flag("topic");
  const [sub, given] = args;
  if (given === undefined || (sub !== "create" && sub !== "delete"))
    return usage("channel needs create or delete and a name", [
      "pnpm --silent discord channel create <name>",
      "pnpm --silent discord channel delete <name>",
    ]);
  needAdmin("making channels");
  // As Discord names it, so asking twice for "Cup Check" finds the cup-check the first made.
  const name = /^\d{17,20}$/.test(given) ? given : channelName(given);
  const all = await serverChannels();
  const found = findChannel(name, all);
  if (sub === "create") {
    if ("channel" in found)
      return say([
        `channel: #${found.channel.name} (no-op: it exists)`,
        ...helpLines([`pnpm --silent discord post ${found.channel.name} <text>`]),
      ]);
    const made = await call<ApiChannel>("create channel", () =>
      rest.post(Routes.guildChannels(guildId), {
        body: { name, type: ChannelType.GuildText, topic: topic ?? LOOSE_TOPIC },
      }),
    );
    return say([
      `created: #${made.name}`,
      ...helpLines([
        `pnpm --silent discord post ${made.name} <text>`,
        `pnpm --silent discord channel delete ${made.name}`,
      ]),
    ]);
  }
  if (!("channel" in found))
    return say([
      `channel: ${name} (no-op: there is none)`,
      ...helpLines(["pnpm --silent discord channels"]),
    ]);
  const c = found.channel;
  // An id the server's list doesn't hold (a thread, another server's channel) has no category to check.
  const listed = all.some((x) => x.id === c.id);
  if (c.id === sandbox?.channelId)
    return fail(`#${c.name} is this checkout's sandbox`, ["pnpm --silent discord sandbox delete"]);
  if ((!listed || !isLoose(c)) && !force)
    return fail(
      listed
        ? `#${c.name} sits in one of the server's categories, so it is someone's real channel`
        : `${c.id} isn't one of the server's channels, so nothing says it is a leftover`,
      [`pnpm --silent discord channel delete ${c.name} --force   (only if Will asked for it gone)`],
    );
  await call("delete channel", () => rest.delete(Routes.channel(c.id)));
  return say([`deleted: #${c.name}`, ...helpLines(["pnpm --silent discord channels"])]);
};

const NO_PINGS = { parse: [] as Array<string> };

/** Post as the Admin app: text and files, pinging nobody. */
const send = async (channelId: string, content: string, files: ReadonlyArray<string>) => {
  for (const f of files) if (!existsSync(f)) return fail(`no file at ${f}`);
  return call<ApiMessage>("post", () =>
    rest.post(Routes.channelMessages(channelId), {
      body: {
        content,
        allowed_mentions: NO_PINGS,
        attachments: files.map((f, i) => ({ id: i, filename: basename(f) })),
      },
      files: files.map((f) => ({ name: basename(f), data: readFileSync(f) })),
    }),
  );
};

const postCmd = async () => {
  needAdmin("posting");
  const files = flags("file");
  const [ref, ...words] = args;
  if (ref === undefined) return usage("post needs a channel", ["pnpm --silent discord channels"]);
  const text = words.join(" ");
  if (text === "" && files.length === 0)
    return usage("post needs text or --file <path>", [
      `pnpm --silent discord post ${ref} "<text>"`,
    ]);
  const c = await channelOf(ref);
  const m = await send(c.id, text, files);
  say([
    `posted: ${m.id} in #${c.name}`,
    `link: ${link(c.id, m.id)}`,
    ...helpLines([`pnpm --silent discord show ${m.id}${inFlag(c)}`]),
  ]);
};

/** A value that reads as a file's path: a typo in one must not post the path as text. */
const looksLikeFile = (value: string) =>
  /^[^\s]+\.(png|jpe?g|gif|webp|svg|mp4|txt|json)$/i.test(value);

const variantsCmd = async () => {
  needAdmin("posting");
  const title = flag("title");
  const [ref, ...pairs] = args;
  if (ref === undefined)
    return usage("variants needs a channel", ["pnpm --silent discord channels"]);
  const parsed = parseVariants(pairs);
  if ("bad" in parsed)
    return usage(
      parsed.bad === ""
        ? "variants needs at least one label=<file|text>"
        : `"${parsed.bad}" isn't label=<file|text>`,
      [`pnpm --silent discord variants ${ref} A=scratch/a.png B=scratch/b.png --title "Round 1"`],
    );
  const missing = parsed.variants.find((v) => looksLikeFile(v.value) && !existsSync(v.value));
  if (missing !== undefined) return fail(`no file at ${missing.value} (variant ${missing.label})`);
  const c = await channelOf(ref);
  const posted: Array<[string, string, string]> = [];
  if (title !== undefined) {
    const m = await send(c.id, `## ${title}`, []);
    posted.push(["title", m.id, link(c.id, m.id)]);
  }
  for (const v of parsed.variants) {
    const file = existsSync(v.value);
    const m = await send(
      c.id,
      file ? `**${v.label}**` : `**${v.label}**\n${v.value}`,
      file ? [v.value] : [],
    );
    posted.push([v.label, m.id, link(c.id, m.id)]);
  }
  say([
    ...table("variants", ["label", "id", "link"], posted),
    ...helpLines([`pnpm --silent discord read ${c.name}`]),
  ]);
};

interface ApiWebhook {
  readonly id: string;
  readonly name: string | null;
  readonly token?: string;
}

const webhookCmd = async () => {
  const out = flag("out");
  const [ref, name] = args;
  if (ref === undefined || name === undefined || out === undefined)
    return usage("webhook needs a channel, a name and --out <file>", [
      "pnpm --silent discord webhook <channel> <name> --out scratch/webhook.txt",
    ]);
  needAdmin("making webhooks");
  const c = await channelOf(ref);
  const existing = await call<ReadonlyArray<ApiWebhook>>("list webhooks", () =>
    rest.get(Routes.channelWebhooks(c.id)),
  );
  const had = existing.find((w) => w.name === name && w.token !== undefined);
  const hook =
    had ??
    (await call<ApiWebhook>("create webhook", () =>
      rest.post(Routes.channelWebhooks(c.id), { body: { name } }),
    ));
  // Owner-only from the first byte; chmod as well for a file that was already there.
  writeFileSync(out, `https://discord.com/api/webhooks/${hook.id}/${hook.token ?? ""}\n`, {
    mode: 0o600,
  });
  chmodSync(out, 0o600);
  say([
    `webhook: ${name} in #${c.name}${had === undefined ? "" : " (no-op: it exists)"}`,
    `url: written to ${out} (secret: pass the file, never print it)`,
    ...helpLines([`pnpm --silent discord read ${c.name}   (after the first post through it)`]),
  ]);
};

const opsCmd = async () => {
  const since = flag("since") ?? "24h";
  const limit = Number(flag("limit") ?? 20);
  const window = parseSince(since);
  if (window === null) return usage(`--since takes 30m, 6h or 2d, not "${since}"`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    return usage("--limit takes a whole number from 1 to 100");
  const c = await channelOf("ops");
  const from = Date.now() - window;
  // Discord's most at once: the window is counted in full, then its newest `limit` are shown.
  const inWindow = (await messages(c.id, 100)).filter(
    (m) => m.timestamp === undefined || Date.parse(m.timestamp) >= from,
  );
  const ms = inWindow.slice(-limit);
  if (ms.length === 0) return say(`ops: nothing in #ops in the last ${since}`);
  say([
    `count: ${ms.length} of ${inWindow.length}${inWindow.length === 100 ? "+" : ""} in the last ${since}`,
    ...table(
      "ops",
      ["id", "at", "shows"],
      ms.map((m) => [m.id, (m.timestamp ?? "").slice(0, 16).replace("T", " "), summary(m, 160)]),
    ),
    ...helpLines([
      `pnpm --silent discord show <id> --in ops`,
      `pnpm --silent discord ops --since 7d`,
    ]),
  ]);
};

interface Command {
  /** Its arguments, as the usage page shows them. */
  readonly usage: string;
  readonly run: () => Promise<void> | void;
  /** Its flags, with their defaults where they have one. */
  readonly flags: ReadonlyArray<string>;
  /** What it does, then two or three examples. */
  readonly help: ReadonlyArray<string>;
}

const A = "pnpm --silent discord";
const COMMANDS: Record<string, Command> = {
  channels: {
    usage: "channels",
    run: channelsCmd,
    flags: [],
    help: ["the server's channels by name, with their last post's age", `${A} channels`],
  },
  channel: {
    usage: "channel create|delete <name>",
    run: channelCmd,
    flags: ["--topic <text>", "--force"],
    help: [
      "make or remove a channel; delete takes only a loose one (outside every category) without --force",
      `${A} channel create design-round`,
      `${A} channel create design-round --topic "Daily Post variants"`,
      `${A} channel delete design-round`,
    ],
  },
  post: {
    usage: "post <channel> [text]",
    run: postCmd,
    flags: ["--file <path> (repeats)"],
    help: [
      "post as the Admin app, pinging nobody",
      `${A} post cup-check "standings after Friday"`,
      `${A} post cup-check --file scratch/standings.png --file scratch/final.png`,
    ],
  },
  variants: {
    usage: "variants <channel> <label>=<file|text>..",
    run: variantsCmd,
    flags: ["--title <text>"],
    help: [
      "a design round: the title, then each variant under its label; a value is a file if it exists",
      `${A} variants cup-check A=scratch/a.png B=scratch/b.png --title "Round 1"`,
      `${A} variants cup-check "A=Top 3 only" "B=Everyone"`,
    ],
  },
  webhook: {
    usage: "webhook <channel> <name>",
    run: webhookCmd,
    flags: ["--out <file> (required)"],
    help: [
      "a webhook in a channel, made once; its URL goes to the file only (mode 600)",
      `${A} webhook search-analytics "Traffic Report" --out scratch/traffic-webhook.txt`,
    ],
  },
  ops: {
    usage: "ops",
    run: opsCmd,
    flags: ["--since <30m|6h|2d> (24h)", "--limit <n> (20, at most 100)"],
    help: [
      "#ops: the bot's alerts, production's included, newest last",
      `${A} ops`,
      `${A} ops --since 7d --limit 100`,
    ],
  },
  read: {
    usage: "read [channel|thread]",
    run: read,
    flags: ["--in <channel|thread>", "--limit <n> (10)", "--full"],
    help: [
      "newest messages, oldest first (default: the sandbox channel)",
      `${A} read ops`,
      `${A} read <thread id> --limit 20`,
    ],
  },
  show: {
    usage: "show <message>",
    run: show,
    flags: ["--in <channel|thread> (the sandbox)", "--full"],
    help: [
      "one message: text, embeds and their links, images (saved locally), buttons, pings",
      `${A} show <message id>`,
      `${A} show <message id> --in ops --full`,
    ],
  },
  threads: {
    usage: "threads",
    run: threads,
    flags: [],
    help: ["the sandbox channel's Match Threads", `${A} threads`],
  },
  members: {
    usage: "members [query]",
    run: members,
    flags: [],
    help: ["server members and their ids, for --as", `${A} members`, `${A} members dev`],
  },
  press: {
    usage: "press <custom id|label>",
    run: press,
    flags: ["--as <member> (required)", "--message <id>"],
    help: [
      "click a button as a member; a label is looked up in the last private answer, the sandbox's newest posts and its Match Threads",
      `${A} press "New Match" --as admin`,
      `${A} press "Play again" --as admin --message <id>`,
      `${A} press mb:quit:m1 --as <member id>`,
    ],
  },
  pick: {
    usage: "pick <custom id> <value..>",
    run: pick,
    flags: ["--as <member> (required)"],
    help: ["choose in a select menu", `${A} pick mb:target <member id> --as admin`],
  },
  submit: {
    usage: "submit <custom id> <field=value..>",
    run: submit,
    flags: ["--as <member> (required)"],
    help: ["submit a form", `${A} submit mb:linkform profile=alice --as admin`],
  },
  time: {
    usage: "time <match> <seconds>",
    run: time,
    flags: ["--as <member> (required)"],
    help: ["a finished run on the Match's Map (fake Steam)", `${A} time m1 18.2 --as admin`],
  },
  run: {
    usage: "run <map title|board id> <seconds>",
    run: runCmd,
    flags: ["--as <member> (required)"],
    help: [
      "a finished run on any Map (fake Steam), for the Weekly Cup",
      `${A} run "Sway n So" 21.4 --as admin`,
    ],
  },
  clock: {
    usage: "clock [time]",
    run: clockCmd,
    flags: [],
    help: [
      "the sandbox's clock, or move it forward (needs sandbox start --cup)",
      `${A} clock`,
      `${A} clock 2026-11-05T12:00:30-06:00`,
    ],
  },
  steam: {
    usage: "steam down|up",
    run: steamCmd,
    flags: [],
    help: ["make every fake Steam read fail, or stop failing", `${A} steam down`, `${A} steam up`],
  },
  wait: {
    usage: "wait <text>",
    run: wait,
    flags: ["--in <channel|thread> (the sandbox)", "--timeout <s> (30)"],
    help: [
      'until a new message whose text or image name has it ("" for any)',
      `${A} wait "Go!" --in <thread id>`,
      `${A} wait "Final result" --in <thread id> --timeout 400`,
    ],
  },
  sandbox: {
    usage: "sandbox create|start|stop|delete",
    run: sandboxCmd,
    flags: ["--cup", "--keep"],
    help: [
      "the sandbox: create (a channel), start (the bot, back once logged in), stop, delete",
      `${A} sandbox create`,
      `${A} sandbox start --cup`,
      `${A} sandbox stop`,
    ],
  },
};

const flagName = (f: string) => f.split(" ")[0] ?? f;

/** The usage page, from each command's own entry, so the two can't disagree. */
const usagePage = () => [
  `usage: ${A} [command] [args]   (bare: the test server at a glance)`,
  ...Object.values(COMMANDS).map(
    (c) =>
      `  ${c.usage}${c.flags.length === 0 ? "" : ` [${c.flags.map(flagName).join(" ")}]`}: ${c.help[0] ?? ""}`,
  ),
  "channels: a name (ops, #cup-check) or an id; threads by id.",
  'members: a numeric id, "admin" (this tool\'s app), or a name to look up.',
  `${A} <command> --help for its flags and examples.`,
];

const name = args.shift();
if (name === undefined || name === "help" || name === "--help") {
  if (name === undefined && !has("help")) await home();
  else say(usagePage());
} else {
  const command = COMMANDS[name];
  if (command === undefined) usage(`unknown command "${name}"`, [`${A} --help`]);
  else if (has("help"))
    say([
      `${A} ${name}: ${command.help[0] ?? ""}`,
      `flags: ${command.flags.length === 0 ? "none" : command.flags.join(", ")}`,
      "examples:",
      ...command.help.slice(1).map((e) => `  ${e}`),
    ]);
  else {
    const known = command.flags.map(flagName);
    const unknown = args.find((a) => a.startsWith("--") && !known.includes(a));
    if (unknown !== undefined)
      usage(
        `unknown flag ${unknown} for ${name} (its flags: ${known.length === 0 ? "none" : known.join(" ")})`,
        [`${A} ${name} --help`],
      );
    else await command.run();
  }
}
