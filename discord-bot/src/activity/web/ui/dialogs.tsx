// The dialogs over a screen (linking Steam, leaving a live Match) and the toast at the top.
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { type HowtoPart, STEAM_LINK_HOWTO } from "../../../present.js";
import type { LinkPreview, MatchView } from "../../api.js";
import { ApiError, messageOf } from "../client.js";
import { useClient } from "../queries.js";
import type { Viewer } from "../types.js";
import { Marble } from "./art.js";
import { Btn, useActions } from "./controls.js";
import { Stack, titleOf } from "./match.js";

/** A modal over the page: Escape or a click outside closes it, unless it's waiting on the server. */
const Dialog = ({
  label,
  onClose,
  locked,
  children,
}: {
  readonly label: string;
  readonly onClose: () => void;
  readonly locked: boolean;
  readonly children: ReactNode;
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [locked, onClose]);
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
};

const Howto = ({ parts }: { readonly parts: ReadonlyArray<HowtoPart> }) => (
  <>
    {parts.map((p, i) =>
      typeof p === "string" ? (
        p
      ) : "menu" in p ? (
        <b key={i} style={{ color: "var(--text)" }}>
          {p.menu}
        </b>
      ) : (
        <code key={i} style={{ color: "var(--text)", overflowWrap: "anywhere" }}>
          {p.example}
        </code>
      ),
    )}
  </>
);

const DIM = { fontSize: 13, color: "var(--dim)" } as const;

/** Link a Steam account (or change it): paste the profile, check it's you, confirm. */
export const LinkDialog = ({
  viewer,
  joining,
  onClose,
  onLinked,
}: {
  readonly viewer: Viewer;
  /** The Match being joined once linked, if any. */
  readonly joining: MatchView | null;
  readonly onClose: () => void;
  readonly onLinked: () => Promise<void>;
}) => {
  const client = useClient();
  const changing = viewer.link !== null;
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const check = useMutation({
    mutationFn: (profile: string) => client.previewLink(profile),
    onSuccess: setPreview,
  });
  const confirm = useMutation({
    mutationFn: async () => {
      await client.confirmLink();
      await onLinked();
    },
  });
  const busy = check.isPending || confirm.isPending;
  const error = check.error ?? confirm.error;
  const errorText =
    error === null
      ? ""
      : error instanceof ApiError && error.error === "ProfileNotFound"
        ? "Couldn't find that profile. Check the link and try again."
        : messageOf(error);
  const title = changing ? "Change your Steam account" : "Link your Steam account";
  return (
    <Dialog label={title} onClose={onClose} locked={busy}>
      <div className="form">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span className="mt" style={{ fontSize: 20 }}>
            {title}
          </span>
          <button className="link" type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        {joining === null ? null : (
          <div className="ctx">
            <Stack m={joining} size={20} />
            <span>Joining {titleOf(joining)}</span>
          </div>
        )}
        {preview !== null ? (
          <>
            <div className="found">
              <Marble steamId={preview.steamId} size={52} skin={preview.skin} />
              <div style={{ minWidth: 0 }}>
                <div className="hud" style={{ fontWeight: 700, fontSize: 18 }}>
                  {preview.personaName}
                </div>
                <div className="note">
                  SteamID {preview.steamId} · times on {preview.campaignTracks} of{" "}
                  {preview.campaignTrackTotal} Circuit Tracks
                </div>
              </div>
            </div>
            <div className="note" style={DIM}>
              Is this you?
            </div>
            {errorText === "" ? null : <div className="err">{errorText}</div>}
            <div className="row-btns">
              <Btn look="go" free disabled={busy} onClick={() => confirm.mutate()}>
                {joining !== null
                  ? "Link and join"
                  : changing
                    ? "Yes, link this one"
                    : "Yes, link it"}
              </Btn>
              <Btn
                look="ghost"
                free
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  check.reset();
                  confirm.reset();
                }}
              >
                Try again
              </Btn>
            </div>
          </>
        ) : (
          <form
            style={{ display: "contents" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim() !== "" && !busy) check.mutate(input.trim());
            }}
          >
            {viewer.link !== null ? (
              <div className="note" style={DIM}>
                Linked to <b style={{ color: "var(--text)" }}>{viewer.link.personaName}</b> (
                {viewer.link.steamId}).
              </div>
            ) : null}
            <ol
              className="note"
              style={{ ...DIM, margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}
            >
              {STEAM_LINK_HOWTO.steps.map((step, i) => (
                <li key={i}>
                  <Howto parts={step} />
                </li>
              ))}
            </ol>
            <div className="note" style={DIM}>
              <Howto parts={STEAM_LINK_HOWTO.looksLike} />
              <br />
              {STEAM_LINK_HOWTO.notThis}
            </div>
            <label className="label" htmlFor="profile">
              Steam profile link
            </label>
            <div className="field">
              <input
                id="profile"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
              <Btn look="go" type="submit" free disabled={busy}>
                Check
              </Btn>
            </div>
            {errorText === "" ? null : <div className="err">{errorText}</div>}
          </form>
        )}
      </div>
    </Dialog>
  );
};

export const LeaveDialog = ({
  m,
  onStay,
}: {
  readonly m: MatchView;
  readonly onStay: () => void;
}) => {
  const a = useActions();
  return (
    <Dialog label="Leave this Match?" onClose={onStay} locked={a.busy}>
      <div className="form">
        <span className="mt" style={{ fontSize: 20 }}>
          Leave this Match?
        </span>
        <div className="note" style={DIM}>
          Your best time so far stands, but nothing after this counts.
        </div>
        <div className="row-btns">
          <Btn look="warn" onClick={() => a.leaveLive(m.matchId)}>
            Leave
          </Btn>
          <Btn look="go" onClick={onStay}>
            Stay
          </Btn>
        </div>
      </div>
    </Dialog>
  );
};

export interface ToastButton {
  readonly label: string;
  /** "go" for the green button, "" for the plain one. */
  readonly look: "go" | "";
  readonly onClick: () => void;
}

/** A message at the top: a refusal (red), or news (calm), with optional buttons. */
export interface ToastMessage {
  readonly text: string;
  readonly kind: "error" | "info";
  readonly buttons: ReadonlyArray<ToastButton>;
  /** Stays up until answered or closed, with a Close button; otherwise it goes by itself. */
  readonly sticky: boolean;
}

export const Toast = ({
  t,
  onClose,
}: {
  readonly t: ToastMessage;
  readonly onClose: () => void;
}) => (
  <div className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
    <span className="tt">{t.text}</span>
    {t.buttons.length === 0 ? null : (
      <span className="row-btns">
        {t.buttons.map((b) => (
          <Btn key={b.label} look={`sm ${b.look}`.trim()} onClick={b.onClick}>
            {b.label}
          </Btn>
        ))}
      </span>
    )}
    {t.sticky ? (
      <button className="x" type="button" onClick={onClose} aria-label="Close" title="Close">
        ×
      </button>
    ) : null}
  </div>
);
