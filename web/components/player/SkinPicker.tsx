"use client";
// Picking your Chosen Skin (CONTEXT.md) on your own player page, as the grill-design rounds
// settled it (spec #276: round 1 A, round 2 A5). Drawn only when You is the player on screen:
// the pencil badge on your marble's corner (YourMarble) and "Change your ball" beside Sign out
// (ChangeBall, in Me.tsx) open the dialog; the marble itself still turns over to your avatar.
// A mock board row stays pinned at its top with your name and the ball you tapped, over a grid
// grouped Colours (No skin first), Metals and Specials. A tap only previews; Save sends it to
// PUT or DELETE /api/me/skin and closes, and Cancel, the close button, Escape or the backdrop
// discard it. A saved pick goes into ChosenSkins straight away, so your marble here and in the
// header draw it before any page is read again.
import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useChosenSkin, useSaveChosenSkin } from "../ChosenSkins";
import { PlayerBall } from "../Ball";
import { Marble, type MarbleWho } from "../Marble";
import { useDialog } from "../Modal";
import { useMounted } from "../../hooks/client";
import { useYou } from "../../hooks/me";
import { chosenSkinApiHref } from "../../lib/routes";
import { personaOf } from "../../lib/rules";
import { SKIN_GROUPS, skinName } from "../../lib/skins";

/* opens the dialog; null where it isn't drawn (anyone else's page, or signed out) */
const Opener = createContext<(() => void) | null>(null);

/* the dialog for the player page of `id`, and what opens it, when You is that player */
export function SkinPicker({ id, children }: { id: string; children: ReactNode }) {
  const you = useYou();
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const mine = you.state === "ready" && you.id === id ? you : null;
  return (
    <Opener.Provider value={mine ? () => setOpen(true) : null}>
      {children}
      {mine && mounted
        ? createPortal(
            <PickerDialog
              id={id}
              persona={personaOf(mine.rec.who)}
              open={open}
              onClose={() => setOpen(false)}
            />,
            document.body,
          )
        : null}
    </Opener.Provider>
  );
}

/* the pencil drawn on your marble */
function Pencil() {
  return (
    <svg className="skp-pen" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.6 2.6l2.8 2.8-7.6 7.6-3.5.7.7-3.5z M9.2 4l2.8 2.8" />
    </svg>
  );
}

/* the marble at the top of a player page: on your own, a pencil badge on its corner opens the
   picker, and the marble itself still turns over to your avatar, as everywhere else */
export function YourMarble({ who }: { who: MarbleWho }) {
  const open = useContext(Opener);
  if (!open) return <Marble who={who} />;
  return (
    <span className="skp-mine">
      <Marble who={who} />
      <button
        type="button"
        className="skp-edit"
        aria-label="Change your ball"
        aria-haspopup="dialog"
        onClick={open}
      >
        <Pencil />
      </button>
    </span>
  );
}

/* "Change your ball", beside Sign out on your own page */
export function ChangeBall() {
  const open = useContext(Opener);
  if (!open) return null;
  return (
    <button type="button" className="linkbtn" aria-haspopup="dialog" onClick={open}>
      Change your ball
    </button>
  );
}

/* a ball as the picker draws it: the Skin's picture, or for none your own hue marble */
function Pick({ id, skin }: { id: string; skin: string | null }) {
  return (
    <span className="marble">
      <PlayerBall steamId={id} skin={skin} />
    </span>
  );
}

const FAILED = "Your ball didn't save. Try again in a moment.";
const LIMIT = "That's as many changes as an hour allows. Try again later.";

function PickerDialog({
  id,
  persona,
  open,
  onClose,
}: {
  id: string;
  persona: string;
  open: boolean;
  onClose: () => void;
}) {
  const saved = useChosenSkin(id);
  const record = useSaveChosenSkin();
  /* the ball tapped, undefined until one is: the saved one shows */
  const [draft, setDraft] = useState<string | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = draft === undefined ? saved : draft;
  const { props, close } = useDialog({
    open,
    onClose: () => {
      setDraft(undefined);
      setProblem(null);
      onClose();
    },
  });

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await fetch(
        chosenSkinApiHref(),
        shown
          ? {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ skin: shown }),
            }
          : { method: "DELETE" },
      );
      if (r.ok) {
        record(id, shown);
        close();
      } else setProblem(r.status === 429 ? LIMIT : FAILED);
    } catch {
      setProblem(FAILED);
    }
    setBusy(false);
  };

  const cell = (skin: string | null) => (
    <button
      key={skin ?? "none"}
      type="button"
      className="skp-cell"
      aria-pressed={shown === skin}
      onClick={() => setDraft(skin)}
    >
      <Pick id={id} skin={skin} />
      <span>{skinName(skin)}</span>
    </button>
  );

  return (
    <dialog className="skp" aria-labelledby="skpHead" {...props}>
      <div className="skp-body">
        <div className="dh">
          <h2 id="skpHead">Your ball</h2>
          <button type="button" aria-label="Close" onClick={close}>
            &times;
          </button>
        </div>
        <p className="skp-lead">
          Shown beside your name wherever a run&apos;s own ball isn&apos;t known.
        </p>
        <div className="skp-row" role="status" aria-label="How your row will look">
          <span className="skp-rank" aria-hidden="true">
            4
          </span>
          <Pick id={id} skin={shown} />
          <span className="skp-who">
            <b>{persona}</b>
            <small>{skinName(shown)}</small>
          </span>
          <span className="skp-time" aria-hidden="true">
            0:12.541
          </span>
        </div>
        {SKIN_GROUPS.map(({ group, skins }, i) => (
          <section key={group} aria-labelledby={"skp-" + group}>
            <h3 className="eyebrow" id={"skp-" + group}>
              {group}
            </h3>
            <div className="skp-grid">
              {i === 0 ? cell(null) : null}
              {skins.map((s) => cell(s.skin))}
            </div>
          </section>
        ))}
      </div>
      <div className="skp-foot">
        {problem ? (
          <p className="skp-bad" role="alert">
            {problem}
          </p>
        ) : null}
        <button type="button" className="linkbtn" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="skp-save"
          disabled={busy || shown === saved}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </dialog>
  );
}
