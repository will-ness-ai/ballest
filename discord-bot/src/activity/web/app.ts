// The Activity page. Inside Discord it signs in through the Embedded App SDK; in a plain browser
// it offers the demo's members instead. It asks the API for everything every two seconds (the
// bot itself reads Steam every ten), and redraws only when the page would look different.
//
// When Discord shrinks it to picture-in-picture, it shows just the standings of the Match on
// screen. Otherwise, in order: your own Match if you're in one (the lock), else a Match you
// opened to watch, else the Map Gallery. A Match you were in stays on screen after its Result
// until Back to Matches.
import { Common, DiscordSDK } from "@discord/embedded-app-sdk";
import type { MatchType, Minutes } from "../../domain.js";
import type { Challengeable, MatchView } from "../api.js";
import type { PageConfig } from "../server.js";
import * as V from "./view.js";

interface Me extends V.Viewer {
  /** The open Invite or live Match they're in, or the Challenge that names them. */
  readonly matchId: string | null;
}
interface Preview {
  readonly steamId: string;
  readonly personaName: string;
  readonly campaignTracks: number;
  readonly campaignTrackTotal: number;
}

/** What a member pressed before they had to link Steam; it goes through once they have. */
type Pending =
  { readonly verb: "new" } | { readonly verb: "accept" | "join"; readonly matchId: string };

const REFRESH_MS = 2_000;
/** How long the Go! bar stays up unless its button is pressed. */
const GO_MS = 60_000;
const REVEAL_MS = 1_500;
const TOAST_MS = 6_000;
/**
 * A window this short is Discord's picture-in-picture (about 180px tall) even if its layout event
 * hasn't arrived, so it gets the small view too.
 */
const PIP_MAX_HEIGHT = 240;

const root = document.getElementById("app")!;

let sdk: DiscordSDK | null = null;
let token = "";
/** Server clock minus ours, so countdowns agree with the bot. */
let offset = 0;
const serverNow = () => Date.now() + offset;

const ui = {
  phase: "signing-in" as "signing-in" | "demo" | "wrong" | "failed" | "ready",
  failure: "",
  devUsers: [] as PageConfig["devUsers"],
  me: null as Me | null,
  matches: [] as ReadonlyArray<MatchView>,
  /** The viewer's own Match, shown alone: the lock. Kept after its Result until Back. */
  mine: null as string | null,
  /** A Match the viewer opened to watch. */
  watching: null as string | null,
  /** The Match on screen: `mine`, else `watching`. */
  focus: null as MatchView | null,
  /** Start or Accept pressed: a Map is being picked for this Invite. */
  starting: null as MatchView | null,
  /** The Invite that was cancelled because no Map fitted. */
  noMap: null as MatchView | null,
  composing: false,
  draft: { type: "lobby" as MatchType, minutes: 15 as Minutes, target: null as string | null },
  players: null as ReadonlyArray<Challengeable> | null,
  search: "",
  link: null as {
    step: "paste" | "preview";
    input: string;
    preview: Preview | null;
    error: string;
    pending: Pending | null;
    changing: boolean;
  } | null,
  leaving: null as MatchView | null,
  toast: "",
  toastUntil: 0,
  goFor: null as string | null,
  goUntil: 0,
  revealUntil: 0,
  /** The viewer's PB on each live Lobby's Map they looked at, for Join late. */
  pbs: new Map<string, number | null>(),
  busy: false,
  /** Discord has shrunk the Activity to its picture-in-picture window. */
  pip: false,
};

// ---------------------------------------------------------------- talking to the bot

class ApiError extends Error {
  constructor(
    message: string,
    readonly error: string,
    /** For a Match that's gone: why it ended without a Result, if it did lately. */
    readonly closed: string | null = null,
  ) {
    super(message);
  }
}

const api = async <A>(method: string, path: string, body?: unknown): Promise<A> => {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(
      data.message ?? "Something went wrong. Try again in a moment.",
      data.error ?? "",
      data.closed ?? null,
    );
  return data as A;
};

/** The SDK rejects with plain `{ code, message }` objects, not Errors. */
const describe = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) return String(e.message);
  return String(e);
};

let pickDemoUser: ((id: string) => void) | null = null;

const signIn = async (): Promise<boolean> => {
  const config: PageConfig = await (await fetch("/api/config")).json();
  const params = new URLSearchParams(location.search);
  if (params.has("frame_id")) {
    sdk = new DiscordSDK(config.clientId);
    await sdk.ready();
    if (sdk.guildId !== config.guildId) {
      ui.phase = "wrong";
      return false;
    }
    const { code } = await sdk.commands.authorize({
      client_id: config.clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify", "rpc.activities.write"],
    });
    const res = await fetch("/api/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error(`the bot answered ${res.status}`);
    const { access_token } = await res.json();
    await sdk.commands.authenticate({ access_token });
    token = access_token;
    void sdk
      .subscribe("ACTIVITY_LAYOUT_MODE_UPDATE", ({ layout_mode }) => {
        ui.pip = layout_mode === Common.LayoutModeTypeObject.PIP;
        render();
      })
      .catch(() => undefined);
    return true;
  }
  // The demo's stand-in for Discord's picture-in-picture.
  ui.pip = params.has("pip");
  if (config.devUsers.length === 0) {
    ui.phase = "failed";
    ui.failure = "Open Multiballs from a channel in the Ballest server.";
    return false;
  }
  // The demo: pick who to be. `?as=<id>` skips the question, for a second tab.
  const as =
    params.get("as") ??
    (await new Promise<string>((resolve) => {
      ui.phase = "demo";
      ui.devUsers = config.devUsers;
      pickDemoUser = resolve;
      render();
    }));
  token = `dev-${as}`;
  return true;
};

const matchById = (id: string) =>
  (ui.focus?.matchId === id ? ui.focus : ui.matches.find((m) => m.matchId === id)) ?? null;

/** The Map was just drawn for the viewer's Match: slide it in, and put up Go!. */
const started = (m: MatchView) => {
  ui.revealUntil = Date.now() + REVEAL_MS;
  ui.goFor = m.matchId;
  ui.goUntil = Date.now() + GO_MS;
};

const refresh = async () => {
  const [me, list] = await Promise.all([
    api<Me>("GET", "/api/me"),
    api<{ now: number; matches: ReadonlyArray<MatchView> }>("GET", "/api/matches"),
  ]);
  offset = list.now - Date.now();
  ui.me = me;
  ui.matches = list.matches;
  // The lock: a Match the viewer is racing in. A Challenge that only names them stays in the Gallery.
  const current =
    me.matchId === null ? undefined : list.matches.find((m) => m.matchId === me.matchId);
  if (current !== undefined && V.isRacer(current, me.discordId)) {
    ui.mine = current.matchId;
    ui.watching = null;
    ui.composing = false;
  }
  const id = ui.mine ?? ui.watching;
  let closed: string | null = null;
  let focus =
    id === null
      ? null
      : (list.matches.find((m) => m.matchId === id) ??
        (
          await api<{ match: MatchView | null }>("GET", `/api/matches/${id}`).catch((e) => {
            closed = e instanceof ApiError ? e.closed : null;
            return { match: null };
          })
        ).match);
  // Your Invite went because no Map fitted: say so, whoever pressed Start.
  if (
    ui.mine !== null &&
    focus === null &&
    closed === "noEligibleMap" &&
    ui.focus?.matchId === ui.mine
  )
    ui.noMap = ui.focus;
  // No longer in it (left from the channel, or it ended): a live one is watched, a Result stays, an Invite goes.
  if (ui.mine !== null && me.matchId !== ui.mine && focus?.state !== "finished") {
    if (focus?.state === "live") ui.watching = ui.mine;
    else focus = null;
    ui.mine = null;
  }
  if (focus === null) ui.watching = null;
  const before = ui.focus;
  if (
    before !== null &&
    focus !== null &&
    before.matchId === focus.matchId &&
    before.state === "invite" &&
    focus.state === "live" &&
    ui.mine === focus.matchId
  )
    started(focus);
  ui.focus = focus;
  askPb(focus, me);
};

/** A live Lobby the viewer might join late: read their PB on its Map, once. */
const askPb = (m: MatchView | null, me: Me) => {
  if (
    m === null ||
    m.state !== "live" ||
    !m.actions.includes("join") ||
    me.link === null ||
    ui.pbs.has(m.matchId)
  )
    return;
  ui.pbs.set(m.matchId, null);
  api<{ ticks: number | null }>("GET", `/api/matches/${m.matchId}/pb`).then(
    (r) => {
      ui.pbs.set(m.matchId, r.ticks);
      render();
    },
    () => ui.pbs.delete(m.matchId),
  );
};

const showToast = (text: string) => {
  ui.toast = text;
  ui.toastUntil = Date.now() + TOAST_MS;
};

const failed = (e: unknown) => {
  if (e instanceof ApiError && e.error === "NotMember") ui.phase = "wrong";
  else
    showToast(
      e instanceof ApiError ? e.message : "Couldn't reach Multiballs. Try again in a moment.",
    );
};

/** Run a member's action; if it's turned down, say why and leave the page as it was. */
const act = async (run: () => Promise<void>) => {
  if (ui.busy) return;
  ui.busy = true;
  render();
  try {
    await run();
    await refresh();
  } catch (e) {
    failed(e);
  } finally {
    ui.busy = false;
    render();
  }
};

// ---------------------------------------------------------------- the actions

/** Start a Lobby or accept a 1v1: the Map is picked meanwhile, up to about 20 seconds. */
const startMatch = (verb: "start" | "accept", id: string) =>
  act(async () => {
    const m = matchById(id);
    ui.starting = m;
    render();
    try {
      const r = await api<{ match: MatchView | null }>("POST", `/api/matches/${id}/${verb}`);
      ui.mine = id;
      ui.watching = null;
      if (r.match !== null) {
        ui.focus = r.match;
        started(r.match);
      }
    } catch (e) {
      if (!(e instanceof ApiError && e.error === "NoEligibleMap" && m !== null)) throw e;
      ui.noMap = m;
      ui.mine = null;
    } finally {
      ui.starting = null;
    }
  });

const join = (id: string) =>
  act(async () => {
    const r = await api<{ match: MatchView | null }>("POST", `/api/matches/${id}/join`);
    ui.mine = id;
    ui.watching = null;
    if (r.match?.state === "live") {
      ui.focus = r.match;
      started(r.match);
    }
  });

/** Go ahead, or ask for a Link first and go ahead after it. */
const linked = (pending: Pending) => {
  if (ui.me?.link === null) return openLink(pending);
  if (pending.verb === "new") return compose();
  return pending.verb === "accept" ? startMatch("accept", pending.matchId) : join(pending.matchId);
};

const openLink = (pending: Pending | null) => {
  ui.link = {
    step: "paste",
    input: "",
    preview: null,
    error: "",
    pending,
    changing: ui.me?.link != null,
  };
  render();
  document.getElementById("profile")?.focus();
};

const compose = () => {
  ui.composing = true;
  render();
};

const loadPlayers = () => {
  ui.players = null;
  api<{ players: ReadonlyArray<Challengeable> }>("GET", "/api/players").then(
    (r) => {
      ui.players = r.players;
      render();
    },
    (e) => {
      failed(e);
      render();
    },
  );
};

const check = async () => {
  const link = ui.link;
  if (link === null || ui.busy) return;
  link.input =
    (document.getElementById("profile") as HTMLInputElement | null)?.value.trim() ?? link.input;
  if (link.input === "") return;
  ui.busy = true;
  render();
  try {
    link.preview = await api<Preview>("POST", "/api/link/preview", { profile: link.input });
    link.step = "preview";
    link.error = "";
  } catch (e) {
    link.error =
      e instanceof ApiError && e.error === "ProfileNotFound"
        ? "Couldn't find that profile. Check the link and try again."
        : e instanceof ApiError
          ? e.message
          : "Couldn't reach Multiballs. Try again in a moment.";
  } finally {
    ui.busy = false;
    render();
  }
};

const confirmLink = async () => {
  const link = ui.link;
  if (link === null || ui.busy) return;
  ui.busy = true;
  render();
  try {
    await api("POST", "/api/link/confirm");
    ui.link = null;
    await refresh();
  } catch (e) {
    link.error =
      e instanceof ApiError ? e.message : "Couldn't reach Multiballs. Try again in a moment.";
    return;
  } finally {
    ui.busy = false;
    render();
  }
  if (link.pending !== null) void linked(link.pending);
};

const openExternal = (url: string) => {
  if (sdk !== null) void sdk.commands.openExternalLink({ url });
  else window.open(url, "_blank", "noopener");
};

const back = () => {
  ui.mine = null;
  ui.watching = null;
  ui.focus = null;
  ui.noMap = null;
  render();
  void refresh().then(render, failed);
};

const onAct = (action: string) => {
  const i = action.indexOf(":");
  const verb = i < 0 ? action : action.slice(0, i);
  const arg = i < 0 ? "" : action.slice(i + 1);
  switch (verb) {
    case "dev":
      return pickDemoUser?.(arg);
    case "new":
      return linked({ verb: "new" });
    case "close-new":
      ui.composing = false;
      return render();
    case "type":
      ui.draft.type = arg as MatchType;
      ui.draft.target = null;
      if (ui.draft.type === "challenge") loadPlayers();
      return render();
    case "min":
      ui.draft.minutes = Number(arg) as Minutes;
      return render();
    case "who":
      ui.draft.target = arg;
      return render();
    case "open":
      return act(async () => {
        const { matchId } = await api<{ matchId: string }>("POST", "/api/matches", ui.draft);
        ui.mine = matchId;
        ui.composing = false;
      });
    case "accept":
      return linked({ verb: "accept", matchId: arg });
    case "join":
      return linked({ verb: "join", matchId: arg });
    case "start":
      return startMatch("start", arg);
    case "decline":
      return act(() => api("POST", `/api/matches/${arg}/decline`));
    case "cancel":
      return act(async () => {
        await api("POST", `/api/matches/${arg}/cancel`);
        ui.mine = null;
      });
    case "leave": {
      const m = matchById(arg);
      if (m?.state === "live") {
        ui.leaving = m;
        return render();
      }
      return act(async () => {
        await api("POST", `/api/matches/${arg}/leave`);
        ui.mine = null;
      });
    }
    case "leave-confirm":
      return act(async () => {
        await api("POST", `/api/matches/${arg}/leave`);
        ui.leaving = null;
        ui.mine = null;
        ui.watching = arg;
      });
    case "stay":
      ui.leaving = null;
      return render();
    case "watch":
      ui.watching = arg;
      ui.focus = matchById(arg);
      ui.composing = false;
      render();
      return void refresh().then(render, failed);
    case "back":
      return back();
    case "workshop":
      ui.goUntil = 0;
      openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${arg}`);
      return render();
    case "thread":
      return ui.focus?.links?.thread == null ? undefined : openExternal(ui.focus.links.thread);
    case "channel":
      return ui.focus?.links == null ? undefined : openExternal(ui.focus.links.card);
    case "link":
      return openLink(null);
    case "check":
      return void check();
    case "confirm":
      return void confirmLink();
    case "retry":
      if (ui.link !== null) {
        ui.link.step = "paste";
        ui.link.error = "";
      }
      return render();
    case "close-link":
      if (ui.busy) return;
      ui.link = null;
      return render();
  }
};

root.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act],[data-stop]");
  const action = el?.dataset["act"];
  if (action !== undefined && action !== "") onAct(action);
});
root.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "who") {
    ui.search = input.value;
    render();
  }
  if (input.id === "profile" && ui.link !== null) ui.link.input = input.value;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target as HTMLElement).id === "profile") void check();
  if (e.key === "Escape" && !ui.busy && (ui.link !== null || ui.leaving !== null)) {
    ui.link = null;
    ui.leaving = null;
    render();
  }
});
// A Map with no preview keeps its stand-in art.
root.addEventListener(
  "error",
  (e) => {
    if (!(e.target instanceof HTMLImageElement)) return;
    V.noPreview.add(e.target.dataset["preview"] ?? "");
    e.target.remove();
    drawn = "";
  },
  true,
);
window.addEventListener("resize", () => render());

// ---------------------------------------------------------------- drawing

const screen = (): string => {
  if (ui.phase === "signing-in") return V.signingIn();
  if (ui.phase === "demo") return V.demoSignIn(ui.devUsers);
  if (ui.phase === "wrong") return V.wrongServer();
  if (ui.phase === "failed" || ui.me === null) return V.failed(ui.failure);
  const viewer = ui.me;
  const f = ui.focus;
  if (ui.pip || innerHeight < PIP_MAX_HEIGHT) return V.pip(viewer, f, ui.matches);
  const matchScreen = (m: MatchView, locked: boolean) =>
    V.matchView({
      m,
      viewer,
      locked,
      now: serverNow(),
      wide: root.clientWidth >= 640,
      pb: ui.pbs.get(m.matchId),
      reveal: Date.now() < ui.revealUntil,
    });
  let page: string;
  if (ui.starting !== null) page = V.picking(ui.starting, viewer);
  else if (ui.noMap !== null) page = V.noMap(ui.noMap, viewer);
  else if (f !== null && ui.mine === f.matchId) {
    page =
      f.state === "invite"
        ? f.starting
          ? V.picking(f, viewer)
          : V.myInvite(f, viewer, ui.busy)
        : matchScreen(f, true);
    if (f.state === "live" && ui.goFor === f.matchId && Date.now() < ui.goUntil)
      page = V.goBar(f, offset) + page;
  } else if (f !== null) page = matchScreen(f, false);
  else
    page = V.gallery(
      viewer,
      ui.matches,
      ui.composing
        ? { draft: ui.draft, players: ui.players, search: ui.search, busy: ui.busy }
        : null,
    );
  if (ui.link !== null) {
    const joining =
      ui.link.pending === null || ui.link.pending.verb === "new"
        ? null
        : matchById(ui.link.pending.matchId);
    page += V.linkDialog({ ...ui.link, joining, busy: ui.busy }, viewer);
  }
  if (ui.leaving !== null) page += V.leaveDialog(ui.leaving, ui.busy);
  if (ui.toast !== "") page += V.toast(ui.toast);
  return page;
};

/** A redraw between pressing a button and letting go would swallow the click, so it waits. */
let pressing = false;
let heldBack = false;
document.addEventListener("pointerdown", () => {
  pressing = true;
});
const release = () => {
  pressing = false;
  // After the click has landed.
  if (heldBack) setTimeout(render, 0);
};
document.addEventListener("pointerup", release);
document.addEventListener("pointercancel", release);

let drawn = "";
const render = () => {
  if (pressing) {
    heldBack = true;
    return;
  }
  heldBack = false;
  V.resetIds();
  const html = screen();
  if (html === drawn) return;
  // A redraw replaces everything: keep the typing focus, the caret and the feed's scroll.
  const active = document.activeElement;
  const focusId = active instanceof HTMLInputElement ? active.id : "";
  const caret =
    active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] : null;
  const feedTop = root.querySelector(".feed.scroll")?.scrollTop ?? 0;
  root.innerHTML = html;
  drawn = html;
  if (focusId !== "") {
    const el = document.getElementById(focusId);
    if (el instanceof HTMLInputElement) {
      el.focus();
      if (caret !== null) el.setSelectionRange(caret[0] ?? null, caret[1] ?? null);
    }
  }
  const feed = root.querySelector(".feed.scroll");
  if (feed !== null) feed.scrollTop = feedTop;
  tick();
  setPresence();
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Countdowns move without a redraw; the Go! bar, the reveal and toasts end on time. */
const tick = () => {
  for (const el of root.querySelectorAll<HTMLElement>("[data-until]"))
    el.textContent = clock(Number(el.dataset["until"]) - serverNow());
  const now = Date.now();
  let changed = false;
  if (ui.toast !== "" && now > ui.toastUntil) {
    ui.toast = "";
    changed = true;
  }
  if (ui.goFor !== null && now > ui.goUntil) {
    ui.goFor = null;
    changed = true;
  }
  if (ui.revealUntil !== 0 && now > ui.revealUntil) {
    ui.revealUntil = 0;
    changed = true;
  }
  if (changed) render();
};

/** The viewer's Discord status: "Browsing Matches", "Watching a Match", or "In a Match" with its end. */
let presence = "";
const setPresence = () => {
  if (sdk === null || ui.phase !== "ready") return;
  const f = ui.focus;
  const mine = f !== null && ui.mine === f.matchId && f.state !== "finished";
  const details = mine ? "In a Match" : f !== null ? "Watching a Match" : "Browsing Matches";
  const end = mine && f.state === "live" && f.endsAt !== null ? f.endsAt - offset : null;
  const key = `${details}|${end}`;
  if (key === presence) return;
  presence = key;
  void sdk.commands
    .setActivity({
      activity: { type: 0, details, ...(end === null ? {} : { timestamps: { end } }) },
    })
    .catch(() => undefined);
};

const main = async () => {
  render();
  try {
    if (!(await signIn())) return render();
    await refresh();
    ui.phase = "ready";
  } catch (e) {
    if (e instanceof ApiError && e.error === "NotMember") ui.phase = "wrong";
    else {
      ui.phase = "failed";
      ui.failure = `Couldn't sign in: ${describe(e)}`;
    }
    return render();
  }
  render();
  setInterval(tick, 250);
  setInterval(() => {
    if (!ui.busy)
      refresh().then(render, (e) => {
        if (e instanceof ApiError && e.error === "NotMember") {
          ui.phase = "wrong";
          render();
        }
      });
  }, REFRESH_MS);
};

void main();
