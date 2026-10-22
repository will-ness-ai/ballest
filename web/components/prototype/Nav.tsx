"use client";
/* ==========================================================================
   PROTOTYPE: grill-design for the site's navigation and global search
   (claude/prototype-nav). Never merged: the winner is rebuilt by /implement-spec.
   Every variant replaces the header and the tabs (Shell.tsx); the page under them is
   untouched. ?variant= picks one, ?state= opens the search (open | typed).
   ========================================================================== */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Marble, Rack } from "../Marble";
import { SITE_TITLE, plural } from "../../lib/rules";

export interface NavData {
  workshop: string | null;
  daily: string | null;
  circuit: string | null;
  players: string;
  prefabs: string;
  campaigns: string;
  seasons: Array<{ label: string; href: string; players: number }>;
  today: { title: string; preview: string | null; players: number; href: string } | null;
  topCampaigns: Array<{ title: string; preview: string | null; players: number; href: string }>;
}

type SectionKey = "workshop" | "campaigns" | "daily" | "circuit" | "players" | "prefabs";
interface Section {
  key: SectionKey;
  label: string;
  href: string;
}

const VARIANTS = [
  [
    "A",
    "Top bar",
    "One slim sticky bar: brand, every section, an inline search with a dropdown, You. Phone: brand + search + menu drawer. Campaigns become a top-level section; the tagline goes, Refreshed moves under the bar.",
  ],
  [
    "B",
    "Command palette",
    "Header keeps today's shape, with one wide search button in the middle (Ctrl K or /) that opens a palette over the page. Tabs stay as pills, plus Campaigns. Phone: a full-width search pill above the tabs.",
  ],
  [
    "C",
    "Sidebar + bottom bar",
    "Desktop: a fixed left sidebar with search, sections with icons, Refreshed and You at its foot. Phone: a slim top bar and an app-style bottom tab bar (Maps, Daily, Search, Circuit, More).",
  ],
  [
    "D",
    "Two-tier hub",
    "A top utility bar (brand, wide search, You), then big section tabs, then the section's own sub-tabs (Featured / All Maps / Campaigns, Today / Standings, seasons...). The pages' own sub-tabs would move up into it later.",
  ],
  [
    "E",
    "Mega menu",
    "Three grouped menus (Leaderboards, Players, Prefabs) that open wide panels with previews (today's Daily, top Campaigns). Search is an icon that expands across the whole bar. Phone: a full-screen menu.",
  ],
] as const;
type VariantKey = (typeof VARIANTS)[number][0];

/* ---------- the URL state ---------- */
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  addEventListener("popstate", l);
  return () => {
    listeners.delete(l);
    removeEventListener("popstate", l);
  };
};
const param = (k: string) => new URLSearchParams(location.search).get(k);
const KEY = "proto-nav";
function stored(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function readVariant(): VariantKey {
  const v = param("variant") ?? stored() ?? "A";
  const hit = VARIANTS.find((x) => x[0] === v)?.[0] ?? "A";
  try {
    sessionStorage.setItem(KEY, hit);
  } catch {
    /* no storage: the URL still carries it */
  }
  return hit;
}
function useVariant(): VariantKey | null {
  const path = usePathname();
  const v = useSyncExternalStore(subscribe, readVariant, () => null);
  void path;
  return v;
}
function useStateParam(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => param("state"),
    () => null,
  );
}
const TYPED = "sol";

/* ---------- which section a path is in ---------- */
function sectionOf(path: string): SectionKey | null {
  if (/^\/campaigns?(\/|$)/.test(path)) return "campaigns";
  if (path === "/" || /^\/maps?(\/|$)/.test(path)) return "workshop";
  if (/^\/daily(\/|$)/.test(path)) return "daily";
  if (/^\/board\//.test(path)) return "circuit";
  if (/^\/(players|you|player|vs)(\/|$)/.test(path)) return "players";
  if (/^\/prefabs?(\/|$)/.test(path)) return "prefabs";
  return null;
}
function sectionsOf(d: NavData, campaigns = true): Array<Section> {
  return [
    ...(d.workshop ? [{ key: "workshop" as const, label: "Maps", href: d.workshop }] : []),
    ...(campaigns ? [{ key: "campaigns" as const, label: "Campaigns", href: d.campaigns }] : []),
    ...(d.daily ? [{ key: "daily" as const, label: "Daily", href: d.daily }] : []),
    ...(d.circuit ? [{ key: "circuit" as const, label: "Circuit", href: d.circuit }] : []),
    { key: "players", label: "Players", href: d.players },
    { key: "prefabs", label: "Prefabs", href: d.prefabs },
  ];
}

/* ---------- icons ---------- */
const PATHS: Record<string, string> = {
  workshop: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  campaigns: "M5 21V4M5 4h11l-2 4 2 4H5",
  daily: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  circuit:
    "M8 4h8v4a4 4 0 0 1-8 0zM6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3M12 12v4M8 20h8l-1-4H9z",
  players:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a5.5 5.5 0 0 1 3.5 6",
  prefabs: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  chev: "M7 10l5 5 5-5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  map: "M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14",
};
function Icon({ k }: { k: string }) {
  return (
    <svg className="pn-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[k]} />
    </svg>
  );
}

/* ---------- the search ---------- */
interface Results {
  q: string;
  people: Array<{ id: string; name: string; avatar: string | null; made: number; plays: boolean }>;
  maps: Array<{
    pfid: string;
    title: string;
    creator: string;
    preview: string | null;
    runs: number;
    record: [string, string, number] | null;
  }>;
  mapTotal: number;
  campaigns: Array<{
    slug: string;
    title: string;
    creator: string;
    maps: number;
    players: number;
    preview: string | null;
  }>;
  tracks: Array<{
    name: string;
    display: string;
    group: string;
    players: number;
    img: string | null;
  }>;
  prefabs: Array<{ slug: string; name: string; by: string; pieces: number }>;
  dailies: Array<{ date: string; title: string; preview: string | null; players: number }>;
}

function useSearch(q: string): { res: Results | null; busy: boolean } {
  const [res, setRes] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (!t) {
      setRes(null);
      return;
    }
    const c = new AbortController();
    setBusy(true);
    const timer = setTimeout(() => {
      fetch("/api/proto-search?q=" + encodeURIComponent(t), { signal: c.signal })
        .then((r) => r.json() as Promise<Results | null>)
        .then((r) => {
          setRes(r);
          setBusy(false);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [q]);
  return { res, busy };
}

function Hi({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const fmtTime = (score: number) => {
  const s = score / 100000;
  const m = Math.floor(s / 60);
  return (
    (m ? m + ":" + String(Math.floor(s % 60)).padStart(2, "0") : Math.floor(s)) +
    "." +
    String(Math.round((s % 1) * 1000)).padStart(3, "0")
  );
};

function Hit({
  href,
  thumb,
  title,
  meta,
  kind,
  q,
  onGo,
}: {
  href: string;
  thumb: React.ReactNode;
  title: string;
  meta: React.ReactNode;
  kind: string;
  q: string;
  onGo: () => void;
}) {
  return (
    <Link className="pn-hit" href={href} data-hit onClick={onGo}>
      <span className="pn-thumb">{thumb}</span>
      <span className="pn-hit-text">
        <b>
          <Hi text={title} q={q} />
        </b>
        <small>{meta}</small>
      </span>
      <span className="pn-kind">{kind}</span>
    </Link>
  );
}

function Pic({ src }: { src: string | null }) {
  return src?.startsWith("https://") || src?.startsWith("/") ? (
    <img src={src} alt="" loading="lazy" decoding="async" />
  ) : (
    <Icon k="map" />
  );
}

function ResultList({
  q,
  res,
  busy,
  d,
  onGo,
}: {
  q: string;
  res: Results | null;
  busy: boolean;
  d: NavData;
  onGo: () => void;
}) {
  if (!q.trim())
    return (
      <div className="pn-results">
        <p className="pn-group">Jump to</p>
        {d.today ? (
          <Hit
            href={d.today.href}
            thumb={<Pic src={d.today.preview} />}
            title={"Today's Daily: " + d.today.title}
            meta={plural(d.today.players, "player", "players") + " so far"}
            kind="Daily"
            q=""
            onGo={onGo}
          />
        ) : null}
        {d.seasons.slice(0, 1).map((s) => (
          <Hit
            key={s.href}
            href={s.href}
            thumb={<Icon k="circuit" />}
            title={"Circuit · " + s.label}
            meta={plural(s.players, "player", "players")}
            kind="Circuit"
            q=""
            onGo={onGo}
          />
        ))}
        {d.topCampaigns.slice(0, 2).map((c) => (
          <Hit
            key={c.href}
            href={c.href}
            thumb={<Pic src={c.preview} />}
            title={c.title}
            meta={plural(c.players, "player", "players")}
            kind="Campaign"
            q=""
            onGo={onGo}
          />
        ))}
        <p className="pn-tip">
          Try a player, a maker, a Map, a Campaign, a Track number or a Prefab
        </p>
      </div>
    );
  if (!res) return <div className="pn-results pn-busy">{busy ? "Searching…" : null}</div>;
  const none =
    !res.people.length &&
    !res.maps.length &&
    !res.campaigns.length &&
    !res.tracks.length &&
    !res.prefabs.length &&
    !res.dailies.length;
  if (none)
    return (
      <div className="pn-results">
        <p className="pn-empty">Nothing called “{q}”.</p>
      </div>
    );
  return (
    <div className="pn-results" data-busy={busy || undefined}>
      {res.people.length ? <p className="pn-group">Players and makers</p> : null}
      {res.people.map((p) => (
        <Hit
          key={p.id}
          href={"/player/" + p.id + (p.plays ? "" : "/made")}
          thumb={<Marble who={{ steamId: p.id, persona: p.name, avatar: p.avatar }} still />}
          title={p.name}
          meta={
            [p.plays ? "Player" : null, p.made ? "made " + plural(p.made, "Map", "Maps") : null]
              .filter(Boolean)
              .join(" · ") || "Player"
          }
          kind={p.made ? "Maker" : "Player"}
          q={q}
          onGo={onGo}
        />
      ))}
      {res.maps.length ? <p className="pn-group">Maps</p> : null}
      {res.maps.map((m) => (
        <Hit
          key={m.pfid}
          href={"/map/" + m.pfid}
          thumb={<Pic src={m.preview} />}
          title={m.title}
          meta={
            <>
              by {m.creator} · {plural(m.runs, "run", "runs")}
              {m.record ? " · record " + fmtTime(m.record[2]) : ""}
            </>
          }
          kind="Map"
          q={q}
          onGo={onGo}
        />
      ))}
      {res.mapTotal > res.maps.length ? (
        <Link className="pn-all" href={"/maps?q=" + encodeURIComponent(q)} onClick={onGo} data-hit>
          All {res.mapTotal} Maps matching “{q}” <Icon k="arrow" />
        </Link>
      ) : null}
      {res.campaigns.length ? <p className="pn-group">Campaigns</p> : null}
      {res.campaigns.map((c) => (
        <Hit
          key={c.slug}
          href={"/campaign/" + c.slug}
          thumb={<Pic src={c.preview} />}
          title={c.title}
          meta={`by ${c.creator} · ${plural(c.maps, "Map", "Maps")} · ${plural(c.players, "player", "players")}`}
          kind="Campaign"
          q={q}
          onGo={onGo}
        />
      ))}
      {res.tracks.length ? <p className="pn-group">Circuit</p> : null}
      {res.tracks.map((t) => (
        <Hit
          key={t.name}
          href={"/board/" + t.name}
          thumb={t.img ? <Pic src={t.img} /> : <Icon k="circuit" />}
          title={t.group + " · " + t.display}
          meta={plural(t.players, "player", "players")}
          kind="Circuit"
          q={q}
          onGo={onGo}
        />
      ))}
      {res.dailies.length ? <p className="pn-group">Dailies</p> : null}
      {res.dailies.map((x) => (
        <Hit
          key={x.date}
          href={"/daily/" + x.date}
          thumb={<Pic src={x.preview} />}
          title={x.title}
          meta={x.date + " · " + plural(x.players, "player", "players")}
          kind="Daily"
          q={q}
          onGo={onGo}
        />
      ))}
      {res.prefabs.length ? <p className="pn-group">Prefabs</p> : null}
      {res.prefabs.map((p) => (
        <Hit
          key={p.slug}
          href={"/prefab/" + p.slug}
          thumb={<Icon k="prefabs" />}
          title={p.name}
          meta={`by ${p.by} · ${plural(p.pieces, "piece", "pieces")}`}
          kind="Prefab"
          q={q}
          onGo={onGo}
        />
      ))}
    </div>
  );
}

/* the field and its results; arrow keys move through the hits, Enter opens one */
function SearchPanel({
  d,
  open,
  setOpen,
  className,
  autoFocus,
  inline,
}: {
  d: NavData;
  open: boolean;
  setOpen: (o: boolean) => void;
  className: string;
  autoFocus?: boolean;
  inline?: boolean;
}) {
  const state = useStateParam();
  const [q, setQ] = useState(state === "typed" ? TYPED : "");
  const { res, busy } = useSearch(q);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [sel, setSel] = useState(-1);
  useEffect(() => setSel(-1), [res, q]);
  useEffect(() => {
    if (state === "typed") setQ(TYPED);
  }, [state]);
  useEffect(() => {
    if (open && autoFocus) input.current?.focus();
  }, [open, autoFocus]);
  useEffect(() => {
    if (!inline || !open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("pointerdown", away);
    return () => removeEventListener("pointerdown", away);
  }, [inline, open, setOpen]);
  const hits = () =>
    Array.from(box.current?.querySelectorAll<HTMLAnchorElement>("[data-hit]") ?? []);
  useEffect(() => {
    hits().forEach((h, i) => h.toggleAttribute("data-sel", i === sel));
  });
  const key = (e: React.KeyboardEvent) => {
    const n = hits().length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (s + 1) % Math.max(n, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (s <= 0 ? n - 1 : s - 1));
    } else if (e.key === "Enter") {
      const h = hits()[sel < 0 ? 0 : sel];
      if (h) {
        router.push(h.getAttribute("href") ?? "/");
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  };
  return (
    <div className={"pn-search " + className} ref={box} data-open={open || undefined}>
      <label className="pn-field">
        <Icon k="search" />
        <input
          ref={input}
          type="search"
          value={q}
          placeholder="Search players, Maps, Campaigns…"
          aria-label="Search the site"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={key}
        />
        <kbd>/</kbd>
      </label>
      {open ? (
        <ResultList
          q={q}
          res={res}
          busy={busy}
          d={d}
          onGo={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/* "/" or Ctrl/Cmd K opens the search wherever the page is */
function useHotkey(open: () => void) {
  const ref = useRef(open);
  ref.current = open;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        (e.key === "k" && (e.ctrlKey || e.metaKey)) ||
        (e.key === "/" && !t.closest("input, textarea"))
      ) {
        e.preventDefault();
        ref.current();
      }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
}

/* a full-screen layer over the page (the phone's search, the palette, the menus) */
function Layer({
  open,
  onClose,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    document.documentElement.classList.add("pn-locked");
    return () => {
      removeEventListener("keydown", k);
      document.documentElement.classList.remove("pn-locked");
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className={"pn-layer " + className}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  );
}

function useOpenFromState(): [boolean, (o: boolean) => void] {
  const state = useStateParam();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(state === "open" || state === "typed");
  }, [state]);
  return [open, setOpen];
}

function Brand() {
  return (
    <Link className="pn-brand" href="/">
      <Rack />
      <span className="pn-word">{SITE_TITLE}</span>
    </Link>
  );
}

function SectionLinks({
  list,
  on,
  className,
  icons,
  onGo,
}: {
  list: Array<Section>;
  on: SectionKey | null;
  className: string;
  icons?: boolean;
  onGo?: () => void;
}) {
  return (
    <nav className={className} aria-label="Sections">
      {list.map((s) => (
        <Link
          key={s.key}
          href={s.href}
          aria-current={s.key === on ? "page" : undefined}
          onClick={onGo}
        >
          {icons ? <Icon k={s.key} /> : null}
          <span>{s.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/* ---------- A: the top bar ---------- */
function VariantA({ d, you, fresh }: Slots) {
  const on = sectionOf(usePathname());
  const [open, setOpen] = useOpenFromState();
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const phone = usePhone();
  useHotkey(() => (phone ? setSheet(true) : setOpen(true)));
  useEffect(() => {
    if (phone && open) {
      setSheet(true);
      setOpen(false);
    }
  }, [phone, open, setOpen]);
  const list = sectionsOf(d);
  return (
    <>
      <header className="pnA">
        <Brand />
        <SectionLinks list={list} on={on} className="pnA-links pn-desk" />
        <SearchPanel d={d} open={open} setOpen={setOpen} className="pnA-search pn-desk" inline />
        <button
          type="button"
          className="pn-iconbtn pn-phone"
          aria-label="Search"
          onClick={() => setSheet(true)}
        >
          <Icon k="search" />
        </button>
        <div className="pnA-you">{you}</div>
        <button
          type="button"
          className="pn-iconbtn pn-phone"
          aria-label="Menu"
          onClick={() => setDrawer(true)}
        >
          <Icon k="menu" />
        </button>
      </header>
      <div className="pn-fresh">{fresh}</div>
      <Layer open={drawer} onClose={() => setDrawer(false)} className="pnA-drawer">
        <div className="pn-sheet">
          <div className="pn-sheet-head">
            <Brand />
            <button
              type="button"
              className="pn-iconbtn"
              aria-label="Close"
              onClick={() => setDrawer(false)}
            >
              <Icon k="close" />
            </button>
          </div>
          <SectionLinks
            list={list}
            on={on}
            className="pn-biglinks"
            icons
            onGo={() => setDrawer(false)}
          />
        </div>
      </Layer>
      <Layer open={sheet} onClose={() => setSheet(false)} className="pn-full">
        <div className="pn-sheet">
          <div className="pn-sheet-head">
            <b>Search</b>
            <button
              type="button"
              className="pn-iconbtn"
              aria-label="Close"
              onClick={() => setSheet(false)}
            >
              <Icon k="close" />
            </button>
          </div>
          <SearchPanel
            d={d}
            open
            setOpen={(o) => !o && setSheet(false)}
            className="pn-insheet"
            autoFocus
          />
        </div>
      </Layer>
    </>
  );
}

/* ---------- B: the command palette ---------- */
function VariantB({ d, you, fresh }: Slots) {
  const on = sectionOf(usePathname());
  const [open, setOpen] = useOpenFromState();
  useHotkey(() => setOpen(true));
  return (
    <>
      <header className="pnB">
        <div className="pnB-top">
          <Brand />
          <div className="pnB-you">{you}</div>
        </div>
        <button type="button" className="pnB-trigger" onClick={() => setOpen(true)}>
          <Icon k="search" />
          <span>Search players, Maps, Campaigns…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="pnB-fresh">{fresh}</div>
      </header>
      <SectionLinks list={sectionsOf(d)} on={on} className="pnB-tabs" />
      <Layer open={open} onClose={() => setOpen(false)} className="pnB-palette">
        <div className="pn-sheet">
          <SearchPanel
            d={d}
            open
            setOpen={(o) => !o && setOpen(false)}
            className="pn-insheet"
            autoFocus
          />
          <p className="pnB-keys">
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close
          </p>
        </div>
      </Layer>
    </>
  );
}

/* ---------- C: the sidebar, and a bottom bar on a phone ---------- */
function VariantC({ d, you, fresh }: Slots) {
  const on = sectionOf(usePathname());
  const [open, setOpen] = useOpenFromState();
  const [sheet, setSheet] = useState(false);
  const [more, setMore] = useState(false);
  const phone = usePhone();
  useHotkey(() => (phone ? setSheet(true) : setOpen(true)));
  useEffect(() => {
    if (phone && open) {
      setSheet(true);
      setOpen(false);
    }
  }, [phone, open, setOpen]);
  const list = sectionsOf(d);
  const bottom = list.filter(
    (s) => s.key === "workshop" || s.key === "daily" || s.key === "circuit",
  );
  const rest = list.filter((s) => !bottom.includes(s));
  return (
    <>
      <aside className="pnC-side pn-desk">
        <Brand />
        <SearchPanel d={d} open={open} setOpen={setOpen} className="pnC-search" inline />
        <SectionLinks list={list} on={on} className="pnC-links" icons />
        <div className="pnC-foot">
          {fresh}
          {you}
        </div>
      </aside>
      <header className="pnC-top pn-phone">
        <Brand />
        {you}
      </header>
      <nav className="pnC-bar pn-phone" aria-label="Sections">
        {bottom.slice(0, 2).map((s) => (
          <Link key={s.key} href={s.href} aria-current={s.key === on ? "page" : undefined}>
            <Icon k={s.key} />
            <span>{s.label}</span>
          </Link>
        ))}
        <button type="button" className="pnC-find" onClick={() => setSheet(true)}>
          <Icon k="search" />
          <span>Search</span>
        </button>
        {bottom.slice(2).map((s) => (
          <Link key={s.key} href={s.href} aria-current={s.key === on ? "page" : undefined}>
            <Icon k={s.key} />
            <span>{s.label}</span>
          </Link>
        ))}
        <button
          type="button"
          aria-current={rest.some((s) => s.key === on) ? "page" : undefined}
          onClick={() => setMore(true)}
        >
          <Icon k="more" />
          <span>More</span>
        </button>
      </nav>
      <Layer open={more} onClose={() => setMore(false)} className="pnC-more">
        <div className="pn-sheet">
          <SectionLinks
            list={rest}
            on={on}
            className="pn-biglinks"
            icons
            onGo={() => setMore(false)}
          />
          <div className="pnC-morefresh">{fresh}</div>
        </div>
      </Layer>
      <Layer open={sheet} onClose={() => setSheet(false)} className="pn-full">
        <div className="pn-sheet">
          <div className="pn-sheet-head">
            <b>Search</b>
            <button
              type="button"
              className="pn-iconbtn"
              aria-label="Close"
              onClick={() => setSheet(false)}
            >
              <Icon k="close" />
            </button>
          </div>
          <SearchPanel
            d={d}
            open
            setOpen={(o) => !o && setSheet(false)}
            className="pn-insheet"
            autoFocus
          />
        </div>
      </Layer>
    </>
  );
}

/* ---------- D: the two-tier hub ---------- */
function subsOf(d: NavData, sec: SectionKey | null, path: string) {
  const at = (href: string, exact = false) =>
    exact ? path === href : path === href || path.startsWith(href + "/");
  switch (sec) {
    case "workshop":
    case "campaigns":
      return [
        { label: "Featured", href: "/", on: path === "/" },
        { label: "All Maps", href: "/maps", on: at("/maps") || path.startsWith("/map/") },
        {
          label: "Campaigns",
          href: d.campaigns,
          on: at("/campaigns") || path.startsWith("/campaign/"),
        },
      ];
    case "daily":
      return [
        {
          label: "Today",
          href: "/daily",
          on: path.startsWith("/daily") && !path.includes("standings"),
        },
        { label: "Standings", href: "/daily/standings", on: path.includes("standings") },
      ];
    case "circuit":
      return d.seasons.map((s) => ({ label: s.label, href: s.href, on: at(s.href) }));
    case "players":
      return [
        { label: "Rankings", href: d.players, on: at("/players") },
        { label: "Where you stand", href: "/you", on: at("/you") },
      ];
    case "prefabs":
      return [
        {
          label: "Shared",
          href: "/prefabs",
          on: path === "/prefabs" || path.startsWith("/prefab/"),
        },
        { label: "Make your own", href: "/prefabs/make", on: at("/prefabs/make") },
        { label: "Upload", href: "/prefabs/new", on: at("/prefabs/new") },
      ];
    default:
      return [];
  }
}
function VariantD({ d, you, fresh }: Slots) {
  const path = usePathname();
  const raw = sectionOf(path);
  const on = raw === "campaigns" ? "workshop" : raw;
  const [open, setOpen] = useOpenFromState();
  const [sheet, setSheet] = useState(false);
  const phone = usePhone();
  useHotkey(() => (phone ? setSheet(true) : setOpen(true)));
  useEffect(() => {
    if (phone && open) {
      setSheet(true);
      setOpen(false);
    }
  }, [phone, open, setOpen]);
  const subs = subsOf(d, on, path);
  return (
    <>
      <header className="pnD">
        <div className="pnD-util">
          <Brand />
          <SearchPanel d={d} open={open} setOpen={setOpen} className="pnD-search pn-desk" inline />
          <button
            type="button"
            className="pn-iconbtn pn-phone"
            aria-label="Search"
            onClick={() => setSheet(true)}
          >
            <Icon k="search" />
          </button>
          {you}
        </div>
        <SectionLinks list={sectionsOf(d, false)} on={on} className="pnD-sections" icons />
        {subs.length ? (
          <nav className="pnD-subs" aria-label="In this section">
            {subs.map((s) => (
              <Link key={s.label} href={s.href} aria-current={s.on ? "page" : undefined}>
                {s.label}
              </Link>
            ))}
            <span className="pnD-fresh">{fresh}</span>
          </nav>
        ) : (
          <div className="pn-fresh">{fresh}</div>
        )}
      </header>
      <Layer open={sheet} onClose={() => setSheet(false)} className="pn-full">
        <div className="pn-sheet">
          <div className="pn-sheet-head">
            <b>Search</b>
            <button
              type="button"
              className="pn-iconbtn"
              aria-label="Close"
              onClick={() => setSheet(false)}
            >
              <Icon k="close" />
            </button>
          </div>
          <SearchPanel
            d={d}
            open
            setOpen={(o) => !o && setSheet(false)}
            className="pn-insheet"
            autoFocus
          />
        </div>
      </Layer>
    </>
  );
}

/* ---------- E: the mega menu ---------- */
function MegaPanel({ which, d, onGo }: { which: string; d: NavData; onGo: () => void }) {
  const L = ({ href, t, s }: { href: string; t: string; s: string }) => (
    <Link className="pnE-link" href={href} onClick={onGo}>
      <b>{t}</b>
      <small>{s}</small>
    </Link>
  );
  if (which === "boards")
    return (
      <div className="pnE-panel">
        <div className="pnE-col">
          <p className="pn-group">Workshop</p>
          {d.workshop ? (
            <L href={d.workshop} t="Featured Maps" s="Most played, newest, closest races" />
          ) : null}
          <L href="/maps" t="All Maps" s="Every player-made Map with a time" />
          <L
            href={d.campaigns}
            t="Campaigns"
            s="Curated runs of player Maps, scored like the Circuit"
          />
        </div>
        <div className="pnE-col">
          <p className="pn-group">Circuit</p>
          {d.seasons.map((s) => (
            <L key={s.href} href={s.href} t={s.label} s={plural(s.players, "player", "players")} />
          ))}
        </div>
        <div className="pnE-col">
          <p className="pn-group">Daily</p>
          {d.today ? (
            <Link className="pnE-feature" href={d.today.href} onClick={onGo}>
              <Pic src={d.today.preview} />
              <span>
                <small>Today&apos;s Daily</small>
                <b>{d.today.title}</b>
                <small>{plural(d.today.players, "player", "players")} so far</small>
              </span>
            </Link>
          ) : null}
          <L href="/daily/standings" t="Daily standings" s="Every Daily, all time" />
        </div>
      </div>
    );
  if (which === "players")
    return (
      <div className="pnE-panel">
        <div className="pnE-col">
          <L href={d.players} t="Player rankings" s="World records, podiums, top fives, Maps" />
          <L href="/you" t="Where you stand" s="You on every standing" />
        </div>
        <div className="pnE-col">
          <p className="pn-group">Top Campaigns</p>
          <div className="pnE-camps">
            {d.topCampaigns.map((c) => (
              <Link key={c.href} className="pnE-camp" href={c.href} onClick={onGo}>
                <Pic src={c.preview} />
                <b>{c.title}</b>
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  return (
    <div className="pnE-panel">
      <div className="pnE-col">
        <L href="/prefabs" t="Shared Prefabs" s="Ready-made pieces for the level editor" />
        <L href="/prefabs/make" t="Make your own" s="QR codes, signs, trees and bushes" />
        <L href="/prefabs/new" t="Upload a Prefab" s="Share one you built" />
      </div>
    </div>
  );
}
function VariantE({ d, you, fresh }: Slots) {
  const path = usePathname();
  const sec = sectionOf(path);
  const [open, setOpen] = useOpenFromState();
  const [mega, setMega] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const phone = usePhone();
  useHotkey(() => (phone ? setSheet(true) : setOpen(true)));
  useEffect(() => {
    if (phone && open) {
      setSheet(true);
      setOpen(false);
    }
  }, [phone, open, setOpen]);
  useEffect(() => setMega(null), [path]);
  const groups = [
    {
      k: "boards",
      label: "Leaderboards",
      on: sec === "workshop" || sec === "campaigns" || sec === "daily" || sec === "circuit",
    },
    { k: "players", label: "Players", on: sec === "players" },
    { k: "prefabs", label: "Prefabs", on: sec === "prefabs" },
  ];
  return (
    <>
      <header
        className="pnE"
        data-searching={open || undefined}
        onPointerLeave={() => setMega(null)}
      >
        <Brand />
        <nav className="pnE-groups pn-desk" aria-label="Sections">
          {groups.map((g) => (
            <button
              key={g.k}
              type="button"
              aria-expanded={mega === g.k}
              aria-current={g.on ? "page" : undefined}
              onPointerEnter={() => setMega(g.k)}
              onClick={() => setMega(mega === g.k ? null : g.k)}
            >
              {g.label}
              <Icon k="chev" />
            </button>
          ))}
        </nav>
        {open ? (
          <SearchPanel d={d} open setOpen={setOpen} className="pnE-search" autoFocus inline />
        ) : (
          <button
            type="button"
            className="pn-iconbtn pnE-find"
            aria-label="Search"
            onClick={() => (phone ? setSheet(true) : setOpen(true))}
          >
            <Icon k="search" />
          </button>
        )}
        <div className="pnE-you">{you}</div>
        <button
          type="button"
          className="pn-iconbtn pn-phone"
          aria-label="Menu"
          onClick={() => setMenu(true)}
        >
          <Icon k="menu" />
        </button>
        {mega ? <MegaPanel which={mega} d={d} onGo={() => setMega(null)} /> : null}
      </header>
      <div className="pn-fresh">{fresh}</div>
      <Layer open={sheet} onClose={() => setSheet(false)} className="pn-full">
        <div className="pn-sheet">
          <div className="pn-sheet-head">
            <b>Search</b>
            <button
              type="button"
              className="pn-iconbtn"
              aria-label="Close"
              onClick={() => setSheet(false)}
            >
              <Icon k="close" />
            </button>
          </div>
          <SearchPanel
            d={d}
            open
            setOpen={(o) => !o && setSheet(false)}
            className="pn-insheet"
            autoFocus
          />
        </div>
      </Layer>
      <Layer open={menu} onClose={() => setMenu(false)} className="pnE-menu">
        <div className="pn-sheet">
          <div className="pn-sheet-head">
            <Brand />
            <button
              type="button"
              className="pn-iconbtn"
              aria-label="Close"
              onClick={() => setMenu(false)}
            >
              <Icon k="close" />
            </button>
          </div>
          {groups.map((g) => (
            <details key={g.k} open={g.on || g.k === "boards"}>
              <summary>{g.label}</summary>
              <MegaPanel which={g.k} d={d} onGo={() => setMenu(false)} />
            </details>
          ))}
        </div>
      </Layer>
    </>
  );
}

/* ---------- the phone test ---------- */
function usePhone() {
  return useSyncExternalStore(
    (l) => {
      const m = matchMedia("(min-width: 51.25em)");
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    () => !matchMedia("(min-width: 51.25em)").matches,
    () => false,
  );
}

interface Slots {
  d: NavData;
  you: React.ReactNode;
  fresh: React.ReactNode;
}

/* what Shell draws in place of its header and tabs */
export function ProtoNav({ original, ...slots }: Slots & { original: React.ReactNode }) {
  const v = useVariant();
  if (!v) return <>{original}</>;
  const V = { A: VariantA, B: VariantB, C: VariantC, D: VariantD, E: VariantE }[v];
  return (
    <div className={"pn pn-" + v}>
      <V {...slots} />
      <ProtoPicker v={v} />
    </div>
  );
}

/* ---------- the variant picker ---------- */
function ProtoPicker({ v }: { v: VariantKey }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const set = (k: string, val: string | null) => {
    const q = new URLSearchParams(location.search);
    if (val === null) q.delete(k);
    else q.set(k, val);
    if (k === "variant" && val) {
      try {
        sessionStorage.setItem(KEY, val);
      } catch {
        /* the URL carries it */
      }
    }
    const s = q.toString();
    history.replaceState(history.state, "", location.pathname + (s ? "?" + s : ""));
    emit();
  };
  const go = (dir: number) => {
    const i = VARIANTS.findIndex((x) => x[0] === v);
    set("variant", VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length][0]);
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, dialog")) return;
      if (e.key === "ArrowLeft") goRef.current(-1);
      if (e.key === "ArrowRight") goRef.current(1);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  const view = useSyncExternalStore(
    subscribe,
    () => param("view"),
    () => null,
  );
  const state = useStateParam();
  const framed = useSyncExternalStore(
    subscribe,
    () => window.top !== window || param("framed") === "1",
    () => false,
  );
  const path = usePathname();
  const href = useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search,
    () => "",
  );
  void path;
  if (framed) return null;
  const meta = VARIANTS.find((x) => x[0] === v);
  const phone = view === "phone";
  const inner = (() => {
    const [p, query = ""] = href.split("?");
    const q = new URLSearchParams(query);
    q.delete("view");
    q.set("variant", v);
    return p + "?" + q.toString();
  })();
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (m: PointerEvent) => setPos({ x: m.clientX - dx, y: m.clientY - dy });
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  return (
    <>
      {phone ? (
        <div className="proto-frame">
          <iframe key={inner} src={inner} title="Phone view" />
        </div>
      ) : null}
      <div
        ref={ref}
        className="proto-picker"
        onPointerDown={drag}
        style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      >
        <div className="pp-row">
          <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
            ←
          </button>
          <b>
            {v} · {meta?.[1]}
          </b>
          <button type="button" onClick={() => go(1)} aria-label="Next variant">
            →
          </button>
        </div>
        <p className="pp-note">{meta?.[2]}</p>
        <div className="pp-row">
          <button type="button" aria-pressed={!phone} onClick={() => set("view", null)}>
            Desktop
          </button>
          <button type="button" aria-pressed={phone} onClick={() => set("view", "phone")}>
            Phone
          </button>
        </div>
        <div className="pp-row">
          {(
            [
              [null, "Closed"],
              ["open", "Search open"],
              ["typed", `“${TYPED}”`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={state === k}
              onClick={() => set("state", k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
