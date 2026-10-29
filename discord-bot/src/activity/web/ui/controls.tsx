// What the viewer can press, wherever it sits: the button, the header's Link and bell, and the
// actions every screen reaches through context (App provides them).
import { createContext, type ReactNode, useContext } from "react";
import { pingsState } from "../../../pingWords.js";
import type { MatchView } from "../../api.js";
import type { Draft } from "../client.js";
import type { Viewer } from "../types.js";
import { Logo, Marble } from "./art.js";

export interface Actions {
  /** A member's action is on its way: every action button waits for it. */
  readonly busy: boolean;
  /** Open the New Match form (asking for a Link first), or close it. */
  readonly newMatch: () => void;
  readonly closeNew: () => void;
  readonly open: (draft: Draft) => void;
  readonly accept: (id: string) => void;
  readonly decline: (id: string) => void;
  readonly join: (id: string) => void;
  readonly start: (id: string) => void;
  readonly cancel: (id: string) => void;
  /** Leave an Invite at once; a live Match asks first. */
  readonly leave: (m: MatchView) => void;
  /** Leave a live Match, once asked: it is watched from then on. */
  readonly leaveLive: (id: string) => void;
  readonly watch: (m: MatchView) => void;
  readonly back: () => void;
  readonly workshop: (pfid: string) => void;
  /** Open a link outside Discord's frame. */
  readonly external: (url: string) => void;
  readonly link: () => void;
  readonly togglePings: () => void;
}

const ActionsContext = createContext<Actions | null>(null);
export const ActionsProvider = ActionsContext.Provider;

export const useActions = () => {
  const a = useContext(ActionsContext);
  if (a === null) throw new Error("useActions outside ActionsProvider");
  return a;
};

/**
 * A button. One that acts on the server (`onClick` without `free`) waits while another action is
 * on its way, as the API takes one at a time.
 */
export const Btn = ({
  look = "",
  onClick,
  disabled = false,
  free = false,
  type = "button",
  children,
}: {
  readonly look?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  /** Pressing it only changes the page: never held back while busy. */
  readonly free?: boolean;
  readonly type?: "button" | "submit";
  readonly children: ReactNode;
}) => {
  // Outside the signed-in page (sign-in, the demo's picker) nothing is ever on its way.
  const busy = useContext(ActionsContext)?.busy ?? false;
  return (
    <button
      type={type}
      className={`btn ${look}`.trim()}
      disabled={disabled || (!free && busy)}
      {...(onClick === undefined ? {} : { onClick })}
    >
      {children}
    </button>
  );
};

const BellIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path
      d="M12 2.5a6 6 0 0 0-6 6v3.6l-1.7 3.1a1 1 0 0 0 .9 1.5h13.6a1 1 0 0 0 .9-1.5L18 12.1V8.5a6 6 0 0 0-6-6Z"
      fill="currentColor"
    />
    <path
      d="M9.5 18.8a2.5 2.5 0 0 0 5 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

/** Lobby pings: lit green with the role, unlit without, dimmed and inert when Discord couldn't say. */
const Bell = ({ pings }: { readonly pings: boolean | null }) => {
  const a = useActions();
  if (pings === null)
    return (
      <button
        className="bell unknown"
        disabled
        title="Lobby pings: Discord didn't say"
        aria-label="Lobby pings"
      >
        <BellIcon />
      </button>
    );
  const label = pingsState(pings);
  return (
    <button
      className={`bell${pings ? " on" : ""}`}
      onClick={a.togglePings}
      title={label}
      aria-label={label}
      aria-pressed={pings}
    >
      <BellIcon />
    </button>
  );
};

export const MeLink = ({ viewer }: { readonly viewer: Viewer }) => {
  const a = useActions();
  if (viewer.link === null)
    return (
      <span className="me-link">
        Not linked ·{" "}
        <button onClick={a.link}>
          <u>Link Steam</u>
        </button>
      </span>
    );
  return (
    <span className="me-link">
      <Marble steamId={viewer.link.steamId} size={18} skin={viewer.link.skin} />
      Linked as <u>{viewer.link.personaName}</u> ·{" "}
      <button onClick={a.link}>
        <u>Change</u>
      </button>
      <Bell pings={viewer.pings} />
    </span>
  );
};

export const TopBar = ({ viewer }: { readonly viewer: Viewer }) => (
  <div className="top">
    <Logo />
    <MeLink viewer={viewer} />
  </div>
);
