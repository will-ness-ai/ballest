// `pnpm -s axi`: the test server, for agents (AXI style: live data first, compact rows, a next
// step after every answer, errors on stdout with exit code 1). It reads the channel and Match
// Threads as the Admin app (ADMIN_DISCORD_TOKEN in the dev .env), makes and removes the sandbox
// channel, and drives the sandbox bot (`pnpm sandbox`) through its local driver: pressing
// buttons, picking, submitting forms as any member, and setting fake Steam times.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { ChannelType, OverwriteType, PermissionFlagsBits, REST, Routes } from "discord.js";
import { type ApiMessage, cell, controlsOf, detail, summary, table } from "./axi/describe.js";
import { devEnvFile } from "./devEnv.js";
import type { Answer } from "./sandbox/driver.js";
import { DRIVER_PORT, LOGS, readSandbox, writeSandbox } from "./sandbox/config.js";

const HELP = `usage: pnpm -s axi [command] [args]
  (none)                         the sandbox at a glance
  read [channel|thread] [--limit n] [--full]
                                 newest messages, oldest first (default: the sandbox channel)
  show <message> [--in <channel|thread>] [--full]
                                 one message: text, images (saved locally), buttons, pings, thread
  threads                        the sandbox channel's Match Threads
  members [query]                server members and their ids, for --as
  press <custom id|label> --as <member> [--message <id>]
                                 click a button as a member (sandbox bot must be running)
  pick <custom id> <value..> --as <member>
                                 choose in a select menu (user picks are member ids or names)
  submit <custom id> <field=value..> --as <member>
                                 submit a form
  time <match> <seconds> --as <member>
                                 a finished run on the Match's Map (fake Steam)
  wait <text> [--in <channel|thread>] [--timeout s]
                                 until a new message containing text arrives
  sandbox create [name] | sandbox delete
                                 make or remove the sandbox channel
members: a numeric id, "admin" (this tool's app), or a name to look up.`;

// ---------------------------------------------------------------- setup

const say = (lines: ReadonlyArray<string> | string) =>
  console.log(typeof lines === "string" ? lines : lines.join("\n"));
const fail = (message: string, help: ReadonlyArray<string> = []): never => {
  say([`error: ${message}`, ...helpLines(help)]);
  process.exit(1);
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
const has = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};

const AXI_DIR = posix.join(LOGS, "axi");
const LAST_REPLY = posix.join(AXI_DIR, "last-reply.json");

const call = async <T>(what: string, run: () => Promise<unknown>): Promise<T> => {
  try {
    return (await run()) as T;
  } catch (e) {
    const code = typeof e === "object" && e !== null && "code" in e ? ` [${String(e.code)}]` : "";
    return fail(`${what}: ${e instanceof Error ? e.message : String(e)}${code}`);
  }
};

const sandbox = readSandbox();
const sandboxChannel = () =>
  sandbox?.channelId ?? fail("no sandbox channel yet", ["pnpm -s axi sandbox create"]);

interface ApiChannel {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly parent_id?: string;
  readonly message_count?: number;
  readonly thread_metadata?: { readonly archived: boolean };
}
interface ApiMember {
  readonly user: { readonly id: string; readonly username: string; readonly bot?: boolean };
  readonly nick?: string | null;
}

const me = () => call<{ id: string; username: string }>("who am I", () => rest.get(Routes.user()));

/** A member by id, "admin", or name. */
const resolveMember = async (who: string | undefined): Promise<string> => {
  if (who === undefined) return fail("--as <member> is required", ["pnpm -s axi members"]);
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
      "pnpm -s axi members " + who,
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
      "pnpm sandbox   (in another shell; log in .logs/sandbox.log)",
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

/** Save a message's attachments under .logs/axi; name to path. */
const saveFiles = async (m: ApiMessage) => {
  const files = new Map<string, string>();
  for (const a of m.attachments ?? []) {
    if (a.url === undefined) continue;
    mkdirSync(AXI_DIR, { recursive: true });
    const path = posix.join(AXI_DIR, `${m.id}-${a.filename}`);
    if (!existsSync(path))
      writeFileSync(path, Buffer.from(await (await fetch(a.url)).arrayBuffer()));
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
  const lines = [
    "pnpm -s axi: the Multiballs test server, for agents",
    `as: ${self.username}${asAdmin ? " (Admin app)" : " (dev bot's token: read-only, no ADMIN_DISCORD_TOKEN)"}`,
  ];
  if (sandbox === null) {
    say([...lines, "sandbox: none", ...helpLines(["pnpm -s axi sandbox create"])]);
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
      ...(h === null ? ["pnpm sandbox   (start the sandbox bot in another shell)"] : []),
      "pnpm -s axi show <message>",
      "pnpm -s axi press <label|custom id> --as <member>",
    ]),
  ]);
};

const read = async () => {
  const where = args[0] ?? sandboxChannel();
  const limit = Number(flag("limit") ?? 10);
  const full = has("full");
  const ms = await messages(where, limit);
  say([
    `channel: ${where}`,
    ...rows(ms, full),
    ...helpLines([
      "pnpm -s axi show <id>" + (where === sandbox?.channelId ? "" : ` --in ${where}`),
    ]),
  ]);
};

const show = async () => {
  const id = args[0] ?? fail("show needs a message id", ["pnpm -s axi read"]);
  const where = flag("in") ?? sandboxChannel();
  const full = has("full");
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
        ? [`pnpm -s axi press ${cell(buttons[0]?.target ?? "")} --as <member>`]
        : []),
      ...(m.thread === undefined ? [] : [`pnpm -s axi read ${m.thread.id}`]),
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
    ...helpLines(["pnpm -s axi read <thread id>"]),
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
  mkdirSync(AXI_DIR, { recursive: true });
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
  say([...lines, ...helpLines(follow)]);
};

/** A custom id, or a button's label looked up in the given message, the last private reply, or the newest channel messages. */
const resolveControl = async (target: string, messageId: string | undefined) => {
  if (target.startsWith("mb:")) return target;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s*\(\d+\)$/, "")
      .trim();
  const pools: Array<ReadonlyArray<ApiMessage>> = [];
  if (messageId !== undefined)
    pools.push([
      await call<ApiMessage>("fetch message", () =>
        rest.get(Routes.channelMessage(sandboxChannel(), messageId)),
      ),
    ]);
  else {
    if (existsSync(LAST_REPLY))
      pools.push(JSON.parse(readFileSync(LAST_REPLY, "utf8")) as ReadonlyArray<ApiMessage>);
    pools.push((await messages(sandboxChannel(), 10)).reverse());
  }
  for (const pool of pools)
    for (const m of pool) {
      const hit = controlsOf(m.components).find(
        (c) => c.kind !== "link" && norm(c.label) === norm(target),
      );
      if (hit !== undefined) return hit.target;
    }
  return fail(`no button labelled "${target}" in the last private reply or the newest messages`, [
    "pnpm -s axi read",
    "pnpm -s axi show <message>",
  ]);
};

const FOLLOW = ["pnpm -s axi read", "pnpm -s axi press <label|custom id> --as <member>"];

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
  if (out.error !== undefined) return fail(out.error, ["pnpm -s axi"]);
  say([out.ok ?? "", ...helpLines(["pnpm -s axi wait <text> --in <thread>"])]);
};

const wait = async () => {
  const text = args[0] ?? fail("wait needs the text to wait for");
  const where = flag("in") ?? sandboxChannel();
  const timeout = Number(flag("timeout") ?? 30) * 1000;
  const seen = new Set((await messages(where, 20)).map((m) => m.id));
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    const hit = (await messages(where, 20)).find(
      (m) => !seen.has(m.id) && summary(m, 2000).toLowerCase().includes(text.toLowerCase()),
    );
    if (hit !== undefined)
      return say([
        ...detail(hit),
        ...helpLines([
          `pnpm -s axi show ${hit.id}${where === sandbox?.channelId ? "" : ` --in ${where}`}`,
        ]),
      ]);
  }
  return fail(`no new message containing "${text}" in ${timeout / 1000} s`, [
    `pnpm -s axi read ${where}`,
  ]);
};

const sandboxCmd = async () => {
  const sub = args[0];
  if (!asAdmin)
    return fail("making channels needs the Admin app: set ADMIN_DISCORD_TOKEN in the dev .env");
  if (sub === "create") {
    if (sandbox !== null)
      return fail(`a sandbox already exists: #${sandbox.channelName}`, [
        "pnpm -s axi sandbox delete",
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
          topic: "Multiballs sandbox for agents (pnpm -s axi). Safe to delete.",
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
      ...helpLines(["pnpm sandbox   (start the sandbox bot in another shell)", "pnpm -s axi"]),
    ]);
  }
  if (sub === "delete") {
    const channelId = sandboxChannel();
    await call("delete channel", () => rest.delete(Routes.channel(channelId)));
    writeSandbox(null);
    return say([`deleted: #${sandbox?.channelName}`, ...helpLines(["pnpm -s axi sandbox create"])]);
  }
  return fail(`unknown sandbox command "${sub ?? ""}"`, [
    "pnpm -s axi sandbox create",
    "pnpm -s axi sandbox delete",
  ]);
};

const COMMANDS: Record<string, () => Promise<void>> = {
  read,
  show,
  threads,
  members,
  press,
  pick,
  submit,
  time,
  wait,
  sandbox: sandboxCmd,
};

if (has("help") || args[0] === "help") say(HELP);
else {
  const name = args.shift();
  if (name === undefined) await home();
  else {
    const run = COMMANDS[name];
    if (run === undefined) {
      say(`error: unknown command "${name}"\n${HELP}`);
      process.exit(2);
    }
    const unknown = args.find((a) => a.startsWith("--"));
    if (
      unknown !== undefined &&
      !["--as", "--in", "--limit", "--full", "--message", "--timeout"].includes(unknown)
    ) {
      say(`error: unknown flag ${unknown}\n${HELP}`);
      process.exit(2);
    }
    await run();
  }
}
