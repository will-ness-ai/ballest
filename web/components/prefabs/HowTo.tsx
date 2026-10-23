"use client";
// How a player uses a Prefab's file: what they type or paste (lib/prefab-console.ts), each with a
// Copy button, and the how-to the ? on a Prefab's viewer and a Generator opens, which links to
// the How to tab for the rest.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { FOLDER, SPAWN } from "../../lib/prefab-console";
import { prefabGuideHref } from "../../lib/routes";

const SEEN = "prefab-howto-seen";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pf-copy"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => undefined, // clipboard blocked: the text is there to select by hand
        );
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function Code({ text }: { text: string }) {
  return (
    <span className="pf-code">
      <code>{text}</code>
      <Copy text={text} />
    </span>
  );
}

function seen() {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

/* the ? on the viewer and the how-to it opens; `name` is the download's name without .json,
   which is what spawnprefab takes. With `auto` it opens on its own once per browser */
export function HelpDialog({ name, auto = true }: { name: string; auto?: boolean }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (auto && !seen()) dlg.current?.showModal();
  }, [auto]);
  const close = () => {
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      // storage blocked: the how-to opens on its own again next visit
    }
  };
  const cmd = SPAWN + " " + name;
  return (
    <>
      <button
        type="button"
        className="pf-q"
        onClick={() => dlg.current?.showModal()}
        aria-label="How to use a prefab"
      >
        ?
      </button>
      <dialog ref={dlg} className="pf-dialog" onClose={close}>
        <h2>Using a prefab</h2>
        <ol className="pf-steps">
          <li>
            <b>Download</b> the file.
          </li>
          <li>
            <b>Put it in</b> your Prefabs folder:
            <Code text={FOLDER} />
          </li>
          <li>
            <b>In the level editor</b>, open the console with the <kbd>`</kbd> key and type:
            <Code text={cmd} />
            It appears in front of the camera as one group.
          </li>
        </ol>
        <form method="dialog">
          <Link href={prefabGuideHref()} onClick={() => dlg.current?.close()}>
            Making and sharing your own
          </Link>
          <button className="pf-x">Got it</button>
        </form>
      </dialog>
    </>
  );
}
