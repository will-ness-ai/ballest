"use client";
// Compare: find the other player by name. A pick fills one side of the head to head; `keep`
// is the player staying put. Opened from a player's page (they stay on the left) and from
// a head to head's "change" (the other side stays). Names come from GET /api/players.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useModalKeys } from "../Behaviours";
import { Marble } from "../Marble";
import type { NameHit } from "../../db/site";
import type { Who } from "../../lib/player";
import { vsHref } from "../../lib/routes";
import { personaOf } from "../../lib/rules";

export interface CompareAsk {
  keep: Who;
  /* the side the pick takes */
  side: "a" | "b";
}

type Hits = Array<NameHit> | "failed" | null;

export function CompareDialog({ ask, close }: { ask: CompareAsk | null; close: () => void }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /* the hits belong to the opening they were found in, so a new one starts empty */
  const [found, setFound] = useState<{ ask: CompareAsk; hits: Hits } | null>(null);
  const hits = found?.ask === ask ? found.hits : null;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const asked = useRef(0);
  useModalKeys(!!ask, box, close);

  /* each opening starts empty, with the box focused */
  useEffect(() => {
    if (!ask) return;
    if (input.current) {
      input.current.value = "";
      input.current.focus();
    }
    const n = asked;
    return () => {
      clearTimeout(timer.current);
      n.current++;
    };
  }, [ask]);

  const search = useCallback(
    (q: string) => {
      if (!ask) return;
      const n = ++asked.current;
      if (!q.trim()) {
        setFound(null);
        return;
      }
      const url =
        "/api/players?q=" +
        encodeURIComponent(q.trim()) +
        "&except=" +
        encodeURIComponent(ask.keep.steamId);
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error("players -> " + String(r.status));
          return r.json() as Promise<Array<NameHit>>;
        })
        .then(
          (list) => {
            if (n === asked.current) setFound({ ask, hits: list });
          },
          () => {
            if (n === asked.current) setFound({ ask, hits: "failed" });
          },
        );
    },
    [ask],
  );

  const pick = (id: string) => {
    if (!ask) return;
    const keep = ask.keep.steamId;
    close();
    router.push(ask.side === "a" ? vsHref(id, keep) : vsHref(keep, id));
  };

  /* only an open dialog is drawn: a page the router keeps hidden for going back to must
     not leave a second one in the document */
  if (!ask) return null;
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
            const v = e.currentTarget.value;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              search(v);
            }, 120);
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
