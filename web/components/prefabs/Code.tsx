"use client";
// What a player types or pastes for a Prefab (lib/prefab-console.ts), with a Copy button: in the
// how-to on a Prefab's viewer and on the How to tab.
import { useState } from "react";

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
