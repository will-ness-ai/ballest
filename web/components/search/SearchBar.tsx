"use client";
// The site search in the header's bar (spec #339, round 2's filter chips). On a desktop a field
// whose results drop down under it; on a phone a button that opens the same search as a
// full-screen sheet (a native dialog, like every modal here). The hits come from GET
// /api/search, scored and grouped by lib/search.ts. "/" or Ctrl/Cmd K reaches it from anywhere,
// ↑/↓ move through the hits, Enter opens one, Esc or a click outside closes it.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";

import { Marble } from "../Marble";
import { useDialog } from "../Modal";
import { SectionIcon } from "../SectionNav";
import { useDebouncedFetch } from "../../hooks/client";
import type { SectionKey } from "../../lib/nav";
import { searchApiHref } from "../../lib/routes";
import { safeImg } from "../../lib/rules";
import {
  marked,
  resultsOf,
  searchTerm,
  type Hit,
  type SearchAnswer,
  type SearchKind,
} from "../../lib/search";

const readSearch = async (q: string) => {
  const r = await fetch(searchApiHref(q));
  if (!r.ok) throw new Error("search -> " + String(r.status));
  return (await r.json()) as SearchAnswer | null;
};

/* the Section whose mark stands in for a hit's picture */
const MARK: Record<SearchKind, SectionKey> = {
  people: "players",
  campaigns: "campaigns",
  maps: "maps",
  tracks: "circuit",
  dailies: "daily",
  prefabs: "prefabs",
};

/* short enough for the field at 820px, between the brand and Sign in with Steam; the empty
   field's tip names every kind it finds */
const PLACEHOLDER = "Search players, Maps…";

/* `you` is You's card, which the phone's button keeps beside it: the bar wraps the two as one */
export function SearchBar({ jumps, you }: { jumps: ReadonlyArray<Hit>; you?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  /* "/" or Ctrl/Cmd K: the field where it shows, else the sheet where its button does. A
     page Next keeps hidden after leaving it shows neither, so its header stays out of it */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select");
      if (!((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing))) return;
      if (field.current?.checkVisibility()) field.current.focus();
      else if (button.current?.checkVisibility()) setSheet(true);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", k);
    return () => {
      removeEventListener("keydown", k);
    };
  }, []);
  return (
    <>
      <Search
        className="srch srch-bar"
        jumps={jumps}
        open={open}
        setOpen={setOpen}
        input={field}
        inline
      />
      <div className="srch-end">
        <button
          ref={button}
          type="button"
          className="srch-btn"
          aria-label="Search the site"
          aria-haspopup="dialog"
          onClick={() => {
            setSheet(true);
          }}
        >
          <SearchMark />
        </button>
        {you}
      </div>
      {sheet && (
        <Sheet
          jumps={jumps}
          from={button}
          onClose={() => {
            setSheet(false);
          }}
        />
      )}
    </>
  );
}

/* the phone's sheet: the field at the top, focused, and the results under it */
function Sheet({
  jumps,
  from,
  onClose,
}: {
  jumps: ReadonlyArray<Hit>;
  from: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { props, close } = useDialog({ open: true, onClose, from, focus: fieldOf });
  /* stable, as useDialog's `focus` is: a new one on every render would close and reopen it */
  const setOpen = useCallback(
    (o: boolean) => {
      if (!o) close();
    },
    [close],
  );
  return (
    <dialog className="srch-sheet" aria-label="Search the site" {...props}>
      <div className="srch-head">
        <b>Search</b>
        <button type="button" aria-label="Close" onClick={close}>
          &times;
        </button>
      </div>
      <Search className="srch srch-in" jumps={jumps} open setOpen={setOpen} />
    </dialog>
  );
}

const fieldOf = (d: HTMLDialogElement) => d.querySelector("input");

/* the field and its results, in the bar (`inline`, which a click outside closes) or the sheet */
function Search({
  className,
  jumps,
  open,
  setOpen,
  input,
  inline = false,
}: {
  className: string;
  jumps: ReadonlyArray<Hit>;
  open: boolean;
  setOpen: (open: boolean) => void;
  input?: RefObject<HTMLInputElement | null>;
  inline?: boolean;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const path = usePathname();
  const [text, setText] = useState("");
  const term = searchTerm(text);
  const found = useDebouncedFetch(term, readSearch);
  /* the answer on screen: the latest, kept while a newer one is read */
  const answer = term ? found.last : null;
  const busy = !!term && answer?.key !== term;
  /* the chip picked and the hit selected, each for the answer it was picked on */
  const [only, setOnly] = useState<{ key: string; kind: SearchKind | null }>({
    key: "",
    kind: null,
  });
  const kind = only.key === answer?.key ? only.kind : null;
  const view = answer?.data ? resultsOf(answer.data, kind) : null;
  /* every link the arrows move through, in the order they are drawn */
  const links: Array<{ href: string }> = term
    ? (view?.groups.flatMap((g) => [...g.hits, ...(g.more ? [g.more] : [])]) ?? [])
    : [...jumps];
  const at = (answer?.key ?? "") + "|" + String(kind);
  const [sel, setSel] = useState({ at: "", i: -1 });
  const selected = sel.at === at ? sel.i : -1;
  const optionId = (i: number) => `${id}-${String(i)}`;

  /* leaving the page closes it: a new path, not a new render or a new `setOpen` */
  const was = useRef(path);
  useEffect(() => {
    if (was.current === path) return;
    was.current = path;
    setOpen(false);
  }, [path, setOpen]);
  /* a press anywhere outside the bar's search closes it */
  useEffect(() => {
    if (!inline || !open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("pointerdown", away);
    return () => {
      removeEventListener("pointerdown", away);
    };
  }, [inline, open, setOpen]);
  /* the selected hit stays in view as the arrows move */
  useEffect(() => {
    if (selected >= 0)
      document.getElementById(optionId(selected))?.scrollIntoView({ block: "nearest" });
  });

  const go = () => {
    setOpen(false);
  };
  const keyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = links.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (!n) return;
      const down = e.key === "ArrowDown";
      setSel({ at, i: down ? (selected + 1) % n : selected <= 0 ? n - 1 : selected - 1 });
    } else if (e.key === "Enter") {
      const to = links[selected < 0 ? 0 : selected] as { href: string } | undefined;
      if (!to || !open) return;
      e.preventDefault();
      router.push(to.href);
      go();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      if (inline) e.currentTarget.blur();
    }
  };

  let i = 0;
  const row = (h: Hit) => {
    const n = i++;
    return (
      <Link
        key={h.href}
        id={optionId(n)}
        role="option"
        aria-selected={n === selected}
        className="srch-hit"
        href={h.href}
        onClick={go}
      >
        <span className="srch-pic">
          {h.who ? (
            <Marble who={h.who} still />
          ) : safeImg(h.img) ? (
            <img src={safeImg(h.img)} alt="" loading="lazy" decoding="async" />
          ) : (
            <SectionIcon k={MARK[h.kind]} />
          )}
        </span>
        <span className="srch-text">
          <b>
            <Marked text={h.title} q={term} />
          </b>
          <small>{h.meta}</small>
        </span>
        <span className="srch-tag">{h.tag}</span>
      </Link>
    );
  };

  /* what the list holds, and what a screen reader hears of it */
  let said: string;
  let body: React.ReactNode;
  if (!term) {
    said = jumps.length ? "Jump to" : "";
    body = (
      <>
        {jumps.length ? (
          <div role="group" aria-labelledby={id + "-jump"}>
            <p className="srch-group" id={id + "-jump"}>
              Jump to
            </p>
            {jumps.map(row)}
          </div>
        ) : null}
        <p className="srch-note">
          Try a player, a maker, a Map, a Campaign, a Track number or a Prefab
        </p>
      </>
    );
  } else if (!view) {
    /* the first answer is still on its way, or the read failed */
    said = found.failed ? "The search didn't answer" : "Searching";
    body = (
      <p className="srch-note">
        {found.failed ? "The search didn't answer. Try again." : "Searching…"}
      </p>
    );
  } else if (!view.groups.length) {
    said = `Nothing called “${answer?.key ?? term}”`;
    body = <p className="srch-note">Nothing called &ldquo;{answer?.key ?? term}&rdquo;.</p>;
  } else {
    said = String(links.length) + (links.length === 1 ? " result" : " results");
    const chips = view.chips;
    body = view.groups.map((g) => (
      <div
        key={g.kind}
        role="group"
        /* under a chip there is no heading: the chip names the kind */
        aria-labelledby={g.heading ? `${id}-${g.kind}` : undefined}
        aria-label={g.heading ? undefined : chips.find((c) => c.kind === g.kind)?.label}
      >
        {g.heading && (
          <p className="srch-group" id={`${id}-${g.kind}`}>
            {g.heading}
          </p>
        )}
        {g.hits.map(row)}
        {g.more &&
          (() => {
            const n = i++;
            return (
              <Link
                id={optionId(n)}
                role="option"
                aria-selected={n === selected}
                className="srch-all"
                href={g.more.href}
                onClick={go}
              >
                All {g.more.total} Maps matching &ldquo;{answer?.key}&rdquo; &rarr;
              </Link>
            );
          })()}
      </div>
    ));
  }

  return (
    <div className={className} ref={box} data-open={open || undefined}>
      <label className="srch-field">
        <SearchMark />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Search the site"
          aria-expanded={open}
          aria-controls={id + "-list"}
          aria-autocomplete="list"
          aria-activedescendant={open && selected >= 0 ? optionId(selected) : undefined}
          placeholder={PLACEHOLDER}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onKeyDown={keyDown}
        />
        {inline && <kbd aria-hidden="true">/</kbd>}
      </label>
      {open && (
        <div
          className="srch-drop"
          data-busy={(busy && !!view) || undefined}
          /* drawn over the page in the bar: qa's overlap probe looks only inside it */
          data-layer={inline || undefined}
        >
          {view && view.chips.length > 0 && (
            <div className="srch-chips" role="group" aria-label="Show">
              {view.chips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  aria-pressed={c.on}
                  onClick={() => {
                    if (answer) setOnly({ key: answer.key, kind: c.kind });
                  }}
                >
                  {c.label}
                  {c.count !== null && <small>{c.count}</small>}
                </button>
              ))}
            </div>
          )}
          <div className="srch-list" id={id + "-list"} role="listbox" aria-label="Search results">
            {body}
          </div>
          <p className="srch-said" role="status">
            {said}
          </p>
        </div>
      )}
    </div>
  );
}

/* the part of a name the query matched, picked out */
function Marked({ text, q }: { text: string; q: string }) {
  const [before, hit, after] = marked(text, q);
  return hit ? (
    <>
      {before}
      <mark>{hit}</mark>
      {after}
    </>
  ) : (
    <>{text}</>
  );
}

function SearchMark() {
  return (
    <svg className="srch-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5" />
    </svg>
  );
}
