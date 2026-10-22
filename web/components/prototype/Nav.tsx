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
import { plural } from "../../lib/rules";

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
    "1",
    "Top hit + groups",
    "The best match as a big card on top (picture, numbers, a button), then the rest grouped by kind, groups ordered by their best match.",
  ],
  [
    "2",
    "Filter chips",
    "A row of chips with counts (All, Players, Maps, Campaigns, Circuit, Dailies, Prefabs). All shows three of each kind; a chip shows every hit of that kind.",
  ],
  [
    "3",
    "List + preview",
    "Desktop: a wide panel, the hits on the left and a preview of the highlighted one on the right (picture, record, players). Arrow keys and hover move it. Phone: the list only.",
  ],
  [
    "4",
    "Visual cards",
    "Players as a row of marbles, Maps and Campaigns as picture cards in a grid, the rest as a compact list.",
  ],
  [
    "5",
    "One ranked list",
    "No groups: every hit in one list, best match first (name match, then how popular), each with its kind tag.",
  ],
] as const;
const BRANDS = [
  ["1", "One word"],
  ["2", "Two-tone"],
  ["3", ".com"],
  ["4", "Stacked"],
  ["5", "Badge"],
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
const KEY = "proto-nav2";
function stored(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function readVariant(): VariantKey {
  const v = param("variant") ?? stored() ?? "1";
  const hit = VARIANTS.find((x) => x[0] === v)?.[0] ?? "1";
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
const TERMS = ["sol", "leth", "habibal", "08"];
function useTyped(): string {
  return useSyncExternalStore(
    subscribe,
    () => param("q") ?? "sol",
    () => "sol",
  );
}
function readBrand(): string {
  const b = param("brand") ?? brandStored() ?? "1";
  try {
    sessionStorage.setItem(KEY + "-brand", b);
  } catch {
    /* the URL carries it */
  }
  return b;
}
function brandStored() {
  try {
    return sessionStorage.getItem(KEY + "-brand");
  } catch {
    return null;
  }
}
function useBrand(): string {
  return useSyncExternalStore(subscribe, readBrand, () => "1");
}

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

function ResultList(props: {
  q: string;
  res: Results | null;
  busy: boolean;
  d: NavData;
  sel: number;
  onGo: () => void;
}) {
  const v = useVariant() ?? "1";
  const { q, res } = props;
  if (!q.trim() || !res || isEmpty(res)) return <Grouped {...props} />;
  const items = itemsOf(res, q);
  if (v === "1") return <TopHit {...props} items={items} />;
  if (v === "2") return <Chips {...props} items={items} />;
  if (v === "3") return <Preview {...props} items={items} />;
  if (v === "4") return <Visual {...props} items={items} />;
  return <Ranked {...props} items={items} />;
}

function Grouped({
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

/* ---------- round 2: five ways to lay the results out ---------- */
type Kind = "people" | "campaigns" | "maps" | "tracks" | "dailies" | "prefabs";
const KIND_NAME: Record<Kind, string> = {
  people: "Players and makers",
  campaigns: "Campaigns",
  maps: "Maps",
  tracks: "Circuit",
  dailies: "Dailies",
  prefabs: "Prefabs",
};
const CHIP_NAME: Record<Kind, string> = {
  people: "Players",
  campaigns: "Campaigns",
  maps: "Maps",
  tracks: "Circuit",
  dailies: "Dailies",
  prefabs: "Prefabs",
};
interface Item {
  key: string;
  kind: Kind;
  tag: string;
  href: string;
  title: string;
  meta: string;
  img: string | null;
  who: { steamId: string; persona: string; avatar: string | null } | null;
  icon: string;
  score: number;
  facts: Array<[string, string]>;
}

function isEmpty(r: Results) {
  return (
    !r.people.length &&
    !r.maps.length &&
    !r.campaigns.length &&
    !r.tracks.length &&
    !r.prefabs.length &&
    !r.dailies.length
  );
}

function match(name: string, q: string) {
  const n = name.toLowerCase();
  if (n === q) return 100;
  if (n.startsWith(q)) return 60;
  if (n.split(/[\s_-]+/).some((w) => w.startsWith(q))) return 40;
  return n.includes(q) ? 20 : 0;
}
const pop = (n: number) => Math.log10(1 + n) * 8;

function itemsOf(r: Results, q: string): Array<Item> {
  const t = q.trim().toLowerCase();
  const out: Array<Item> = [];
  for (const p of r.people)
    out.push({
      key: "p" + p.id,
      kind: "people",
      tag: p.made ? "Maker" : "Player",
      href: "/player/" + p.id + (p.plays ? "" : "/made"),
      title: p.name,
      meta:
        [p.plays ? "Player" : null, p.made ? "made " + plural(p.made, "Map", "Maps") : null]
          .filter(Boolean)
          .join(" · ") || "Player",
      img: null,
      who: { steamId: p.id, persona: p.name, avatar: p.avatar },
      icon: "players",
      score: match(p.name, t) + p.made * 2,
      facts: p.made ? [["Maps made", String(p.made)]] : [],
    });
  for (const c of r.campaigns)
    out.push({
      key: "c" + c.slug,
      kind: "campaigns",
      tag: "Campaign",
      href: "/campaign/" + c.slug,
      title: c.title,
      meta: `by ${c.creator} · ${plural(c.maps, "Map", "Maps")} · ${plural(c.players, "player", "players")}`,
      img: c.preview,
      who: null,
      icon: "campaigns",
      score: match(c.title, t) + pop(c.players) + 10,
      facts: [
        ["Maps", String(c.maps)],
        ["Players", String(c.players)],
        ["By", c.creator],
      ],
    });
  for (const m of r.maps)
    out.push({
      key: "m" + m.pfid,
      kind: "maps",
      tag: "Map",
      href: "/map/" + m.pfid,
      title: m.title,
      meta:
        `by ${m.creator} · ${plural(m.runs, "run", "runs")}` +
        (m.record ? " · record " + fmtTime(m.record[2]) : ""),
      img: m.preview,
      who: null,
      icon: "map",
      score: match(m.title, t) + pop(m.runs),
      facts: [
        ["Runs", String(m.runs)],
        ["Record", m.record ? fmtTime(m.record[2]) : "None yet"],
        ["Holder", m.record ? m.record[1] : "-"],
        ["By", m.creator],
      ],
    });
  for (const x of r.tracks)
    out.push({
      key: "t" + x.name,
      kind: "tracks",
      tag: "Circuit",
      href: "/board/" + x.name,
      title: x.group + " · " + x.display,
      meta: plural(x.players, "player", "players"),
      img: x.img,
      who: null,
      icon: "circuit",
      score: Math.max(match(x.display, t), 20) + pop(x.players) + 5,
      facts: [
        ["Season", x.group],
        ["Players", String(x.players)],
      ],
    });
  for (const x of r.dailies)
    out.push({
      key: "d" + x.date,
      kind: "dailies",
      tag: "Daily",
      href: "/daily/" + x.date,
      title: x.title,
      meta: x.date + " · " + plural(x.players, "player", "players"),
      img: x.preview,
      who: null,
      icon: "daily",
      score: match(x.title, t) + pop(x.players) - 5,
      facts: [
        ["Day", x.date],
        ["Players", String(x.players)],
      ],
    });
  for (const x of r.prefabs)
    out.push({
      key: "f" + x.slug,
      kind: "prefabs",
      tag: "Prefab",
      href: "/prefab/" + x.slug,
      title: x.name,
      meta: `by ${x.by} · ${plural(x.pieces, "piece", "pieces")}`,
      img: null,
      who: null,
      icon: "prefabs",
      score: match(x.name, t) - 5,
      facts: [
        ["Pieces", String(x.pieces)],
        ["By", x.by],
      ],
    });
  return out;
}

function Thumb({ it, big }: { it: Item; big?: boolean }) {
  return (
    <span className={big ? "pn-thumb pn-thumb-big" : "pn-thumb"}>
      {it.who ? (
        <Marble who={it.who} still />
      ) : it.img ? (
        <Pic src={it.img} />
      ) : (
        <Icon k={it.icon} />
      )}
    </span>
  );
}

function Row({
  it,
  q,
  onGo,
  onHover,
}: {
  it: Item;
  q: string;
  onGo: () => void;
  onHover?: () => void;
}) {
  return (
    <Link className="pn-hit" href={it.href} data-hit onClick={onGo} onPointerEnter={onHover}>
      <Thumb it={it} />
      <span className="pn-hit-text">
        <b>
          <Hi text={it.title} q={q} />
        </b>
        <small>{it.meta}</small>
      </span>
      <span className="pn-kind">{it.tag}</span>
    </Link>
  );
}

function byGroup(items: Array<Item>) {
  const groups = new Map<Kind, Array<Item>>();
  for (const it of items) groups.set(it.kind, [...(groups.get(it.kind) ?? []), it]);
  return [...groups.entries()].sort(
    (a, b) => Math.max(...b[1].map((i) => i.score)) - Math.max(...a[1].map((i) => i.score)),
  );
}

interface RProps {
  q: string;
  res: Results | null;
  busy: boolean;
  sel: number;
  onGo: () => void;
  items: Array<Item>;
}

function MoreMaps({ res, q, onGo }: { res: Results | null; q: string; onGo: () => void }) {
  if (!res || res.mapTotal <= res.maps.length) return null;
  return (
    <Link className="pn-all" href={"/maps?q=" + encodeURIComponent(q)} onClick={onGo} data-hit>
      All {res.mapTotal} Maps matching “{q}” <Icon k="arrow" />
    </Link>
  );
}

/* 1: the best match as a card, then the rest grouped */
function TopHit({ q, res, busy, onGo, items }: RProps) {
  const top = [...items].sort((a, b) => b.score - a.score)[0];
  const rest = items.filter((i) => i !== top);
  return (
    <div className="pn-results pn-r1" data-busy={busy || undefined}>
      <p className="pn-group">Top hit</p>
      <Link className="pn-top" href={top.href} data-hit onClick={onGo}>
        <Thumb it={top} big />
        <span className="pn-top-text">
          <span className="pn-kind">{top.tag}</span>
          <b>
            <Hi text={top.title} q={q} />
          </b>
          <small>{top.meta}</small>
          <span className="pn-facts">
            {top.facts.slice(0, 3).map(([k, v]) => (
              <span key={k}>
                <small>{k}</small>
                {v}
              </span>
            ))}
          </span>
        </span>
      </Link>
      {byGroup(rest).map(([k, list]) => (
        <div key={k} className="pn-grp">
          <p className="pn-group">{KIND_NAME[k]}</p>
          {list.map((it) => (
            <Row key={it.key} it={it} q={q} onGo={onGo} />
          ))}
          {k === "maps" ? <MoreMaps res={res} q={q} onGo={onGo} /> : null}
        </div>
      ))}
    </div>
  );
}

/* 2: chips filter the kinds */
function Chips({ q, res, busy, onGo, items }: RProps) {
  const [only, setOnly] = useState<Kind | null>(null);
  const groups = byGroup(items);
  const counts = (k: Kind) =>
    k === "maps" && res ? res.mapTotal : (groups.find((g) => g[0] === k)?.[1].length ?? 0);
  return (
    <div className="pn-results pn-r2" data-busy={busy || undefined}>
      <div className="pn-chips" role="tablist">
        <button type="button" aria-pressed={only === null} onClick={() => setOnly(null)}>
          All
        </button>
        {groups.map(([k]) => (
          <button key={k} type="button" aria-pressed={only === k} onClick={() => setOnly(k)}>
            {CHIP_NAME[k]} <small>{counts(k)}</small>
          </button>
        ))}
      </div>
      {groups
        .filter(([k]) => only === null || only === k)
        .map(([k, list]) => (
          <div key={k} className="pn-grp">
            {only === null ? <p className="pn-group">{KIND_NAME[k]}</p> : null}
            {(only === null ? list.slice(0, 3) : list).map((it) => (
              <Row key={it.key} it={it} q={q} onGo={onGo} />
            ))}
            {k === "maps" && only === "maps" ? <MoreMaps res={res} q={q} onGo={onGo} /> : null}
          </div>
        ))}
    </div>
  );
}

/* 3: a list with a preview of the highlighted hit */
function Preview({ q, busy, sel, onGo, items }: RProps) {
  const order = byGroup(items).flatMap(([, l]) => l);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => setHover(null), [sel]);
  const it = order[hover ?? (sel < 0 ? 0 : Math.min(sel, order.length - 1))];
  let last: Kind | null = null;
  return (
    <div className="pn-results pn-r3" data-busy={busy || undefined}>
      <div className="pn-r3-list">
        {order.map((x, i) => {
          const head = x.kind !== last ? <p className="pn-group">{KIND_NAME[x.kind]}</p> : null;
          last = x.kind;
          return (
            <div key={x.key}>
              {head}
              <Row it={x} q={q} onGo={onGo} onHover={() => setHover(i)} />
            </div>
          );
        })}
      </div>
      {it ? (
        <aside className="pn-pane">
          <Thumb it={it} big />
          <span className="pn-kind">{it.tag}</span>
          <b>{it.title}</b>
          <dl>
            {it.facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <Link className="pn-open" href={it.href} onClick={onGo}>
            Open <Icon k="arrow" />
          </Link>
        </aside>
      ) : null}
    </div>
  );
}

/* 4: pictures first */
function Visual({ q, res, busy, onGo, items }: RProps) {
  const people = items.filter((i) => i.kind === "people");
  const cards = items.filter((i) => i.kind === "campaigns" || i.kind === "maps");
  const rest = items.filter((i) => !people.includes(i) && !cards.includes(i));
  return (
    <div className="pn-results pn-r4" data-busy={busy || undefined}>
      {people.length ? <p className="pn-group">Players and makers</p> : null}
      {people.length ? (
        <div className="pn-people">
          {people.map((it) => (
            <Link key={it.key} className="pn-person" href={it.href} data-hit onClick={onGo}>
              <Thumb it={it} />
              <b>
                <Hi text={it.title} q={q} />
              </b>
              <small>{it.tag}</small>
            </Link>
          ))}
        </div>
      ) : null}
      {cards.length ? <p className="pn-group">Campaigns and Maps</p> : null}
      {cards.length ? (
        <div className="pn-cards">
          {cards.map((it) => (
            <Link key={it.key} className="pn-card" href={it.href} data-hit onClick={onGo}>
              <Pic src={it.img} />
              <span>
                <span className="pn-kind">{it.tag}</span>
                <b>
                  <Hi text={it.title} q={q} />
                </b>
                <small>{it.meta}</small>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
      <MoreMaps res={res} q={q} onGo={onGo} />
      {rest.length ? <p className="pn-group">More</p> : null}
      {rest.map((it) => (
        <Row key={it.key} it={it} q={q} onGo={onGo} />
      ))}
    </div>
  );
}

/* 5: one list, best first */
function Ranked({ q, res, busy, onGo, items }: RProps) {
  return (
    <div className="pn-results pn-r5" data-busy={busy || undefined}>
      {[...items]
        .sort((a, b) => b.score - a.score)
        .map((it) => (
          <Row key={it.key} it={it} q={q} onGo={onGo} />
        ))}
      <MoreMaps res={res} q={q} onGo={onGo} />
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
  const typed = useTyped();
  const [q, setQ] = useState(state === "typed" ? typed : "");
  const { res, busy } = useSearch(q);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [sel, setSel] = useState(-1);
  useEffect(() => setSel(-1), [res, q]);
  useEffect(() => {
    if (state === "typed") setQ(typed);
  }, [state, typed]);
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
          sel={sel}
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
  const b = useBrand();
  return (
    <Link className={"pn-brand pn-brand" + b} href="/" aria-label="Ballest Records">
      {b === "5" ? null : <Rack />}
      {b === "1" ? <span className="pn-word">BALLESTRECORDS</span> : null}
      {b === "2" ? (
        <span className="pn-word">
          BALLEST<em>RECORDS</em>
        </span>
      ) : null}
      {b === "3" ? (
        <span className="pn-word pn-dotcom">
          ballestrecords<em>.com</em>
        </span>
      ) : null}
      {b === "4" ? (
        <span className="pn-word pn-stack">
          BALLEST<em>RECORDS</em>
        </span>
      ) : null}
      {b === "5" ? (
        <span className="pn-word pn-badge">
          <Rack />
          BALLEST<em>RECORDS</em>
        </span>
      ) : null}
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

/* ---------- D: the two-tier hub ---------- */
function subsOf(d: NavData, sec: SectionKey | null, path: string) {
  const at = (href: string, exact = false) =>
    exact ? path === href : path === href || path.startsWith(href + "/");
  switch (sec) {
    case "workshop":
      return [
        { label: "Featured", href: "/", on: path === "/" },
        { label: "All Maps", href: "/maps", on: at("/maps") || path.startsWith("/map/") },
      ];
    case "campaigns":
      return [
        { label: "All Campaigns", href: d.campaigns, on: at("/campaigns") },
        ...d.topCampaigns.map((c) => ({ label: c.title, href: c.href, on: at(c.href) })),
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
  const on = sectionOf(path);
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
        <SectionLinks list={sectionsOf(d)} on={on} className="pnD-sections" icons />
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
  return (
    <div className={"pn pn-D pn-r" + v}>
      <VariantD {...slots} />
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
  const typed = useTyped();
  const brand = useBrand();
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
              ["open", "Open"],
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
          {TERMS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={state === "typed" && typed === t}
              onClick={() => {
                set("q", t);
                set("state", "typed");
              }}
            >
              “{t}”
            </button>
          ))}
        </div>
        <div className="pp-row">
          <span>Name</span>
          {BRANDS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              title={label}
              aria-pressed={brand === k}
              onClick={() => set("brand", k)}
            >
              {k} {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
