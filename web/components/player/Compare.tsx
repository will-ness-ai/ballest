"use client";
// Compare: find the other player by name. A pick fills one side of the head to head; `keep`
// is the player staying put. Opened from a player's page (they stay on the left) and from
// a head to head's "change" (the other side stays). Names come from GET /api/players.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useModalKeys } from "../Behaviours";
import { Marble } from "../Marble";
import type { NameHit } from "../../lib/rows";
import { useDebouncedFetch } from "../../lib/client";
import type { Who } from "../../lib/player";
import { vsHref } from "../../lib/routes";
import { personaOf } from "../../lib/rules";

export interface CompareAsk {
  keep: Who;
  /* the side the pick takes */
  side: "a" | "b";
}

/* only an open dialog is drawn: a page the router keeps hidden for going back to must
   not leave a second one in the document. Each opening is drawn afresh, so it starts
   empty, and an answer to the last one's search never reaches it. */
export function CompareDialog({ ask, close }: { ask: CompareAsk | null; close: () => void }) {
  return ask ? <Open key={ask.side + ask.keep.steamId} ask={ask} close={close} /> : null;
}

function Open({ ask, close }: { ask: CompareAsk; close: () => void }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const keep = ask.keep.steamId;
  const read = useCallback(
    async (q: string) => {
      const r = await fetch(
        "/api/players?q=" + encodeURIComponent(q) + "&except=" + encodeURIComponent(keep),
      );
      if (!r.ok) throw new Error("players -> " + String(r.status));
      return (await r.json()) as Array<NameHit>;
    },
    [keep],
  );
  const found = useDebouncedFetch(text.trim(), read);
  const hits = found.failed ? "failed" : (found.last?.data ?? null);
  useModalKeys(true, box, close);

  /* the box opens focused */
  useEffect(() => {
    input.current?.focus();
  }, []);

  const pick = (id: string) => {
    close();
    router.push(ask.side === "a" ? vsHref(id, keep) : vsHref(keep, id));
  };

  return createPortal(
    <>
      <div className="dscrim" id="cmpScrim" onClick={close} />
      <div
        className="cmp"
        id="cmp"
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmpHead"
      >
        <div className="dh">
          <h2 id="cmpHead">{"Compare " + personaOf(ask.keep) + " with…"}</h2>
          <button type="button" data-cmpclose="" aria-label="Close" onClick={close}>
            &times;
          </button>
        </div>
        <input
          className="ws-q"
          id="cmpq"
          ref={input}
          type="search"
          placeholder="Type a player's name"
          aria-label="Find a player"
          autoComplete="off"
          onInput={(e) => {
            setText(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const first = box.current?.querySelector<HTMLButtonElement>("#cmpHits [data-pick]");
            first?.click();
          }}
        />
        <div className="hits" id="cmpHits">
          {hits === "failed" ? (
            <p>The player list didn&apos;t load. Try again in a moment.</p>
          ) : !hits ? null : hits.length ? (
            hits.map((r) => (
              <button
                key={r.steamId}
                type="button"
                className="hit"
                data-pick={r.steamId}
                onClick={() => {
                  pick(r.steamId);
                }}
              >
                {/* a name list has no avatars, and a button can't hold the marble's button */}
                <Marble who={{ steamId: r.steamId, persona: r.persona }} />
                <b>{personaOf(r)}</b>
              </button>
            ))
          ) : (
            <p>Nobody by that name.</p>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

/* a player's page's Compare button: the player on screen stays on the left */
export function CompareButton({ keep }: { keep: Who }) {
  const [ask, setAsk] = useState<CompareAsk | null>(null);
  const close = useCallback(() => {
    setAsk(null);
  }, []);
  return (
    <>
      <button
        type="button"
        className="steam"
        data-compare=""
        onClick={() => {
          setAsk({ keep, side: "b" });
        }}
      >
        &#9876; Compare
      </button>
      <CompareDialog ask={ask} close={close} />
    </>
  );
}
