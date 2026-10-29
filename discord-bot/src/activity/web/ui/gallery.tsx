// The Map Gallery: every open Invite and live Match as a tile, with the New Match form first.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DURATIONS, formatTime, MATCH_TYPE_NAME, type MatchType } from "../../../domain.js";
import { matchDetails } from "../../../present.js";
import type { MatchView } from "../../api.js";
import type { Draft } from "../client.js";
import { keys, useClient } from "../queries.js";
import type { Viewer } from "../types.js";
import { MapArt, Marble, MarbleIn } from "./art.js";
import { Btn, TopBar, useActions } from "./controls.js";
import { Chip, nameOf, Offer, rankClass, startedAt, titleOf } from "./match.js";

const TYPES: ReadonlyArray<readonly [MatchType, string]> = [
  ["public", "First to accept plays you"],
  ["challenge", "Pick who you play"],
  ["lobby", "Anyone can join; you start it"],
];

/** The Challenge picker: linked Players, searchable by Discord or Steam name, busy ones greyed out. */
const WhoPicker = ({
  target,
  pick,
}: {
  readonly target: string | null;
  readonly pick: (discordId: string) => void;
}) => {
  const client = useClient();
  const [search, setSearch] = useState("");
  const players = useQuery({ queryKey: keys.players, queryFn: client.players, staleTime: 30_000 });
  const q = search.trim().toLowerCase();
  const shown = (players.data ?? []).filter(
    (p) => q === "" || p.name.toLowerCase().includes(q) || p.steamName.toLowerCase().includes(q),
  );
  return (
    <div className="who">
      <input
        id="who"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by Discord or Steam name"
        aria-label="Search Players"
        autoComplete="off"
      />
      <div className="wl">
        {players.isPending ? (
          <span className="note">Loading Players…</span>
        ) : players.isError ? (
          <span className="note">
            Couldn&apos;t load Players.{" "}
            <button className="link" type="button" onClick={() => void players.refetch()}>
              Try again
            </button>
          </span>
        ) : shown.length === 0 ? (
          <span className="note">Nobody by that name.</span>
        ) : (
          shown.map((p) => (
            <button
              key={p.discordId}
              type="button"
              className={`wp ${target === p.discordId ? "on" : ""}`}
              onClick={() => pick(p.discordId)}
              disabled={p.busy}
            >
              <Marble steamId={p.steamId} size={22} skin={p.skin} />
              <span style={{ display: "grid", lineHeight: 1.15, textAlign: "left" }}>
                <span>{p.name}</span>
                <span className="note">
                  {p.steamName}
                  {p.busy ? " · in a Match" : ""}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
      <details className="hint">
        <summary>Can&apos;t find someone?</summary>They need to link Steam in Multiballs first.
        Search by Discord or Steam name.
      </details>
    </div>
  );
};

const Composer = ({
  draft,
  setDraft,
}: {
  readonly draft: Draft;
  readonly setDraft: (d: Draft) => void;
}) => {
  const a = useActions();
  return (
    <div className="gt composing">
      <div className="form">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="label">New Match</span>
          <button className="link" type="button" onClick={a.closeNew}>
            Close
          </button>
        </div>
        <div className="types">
          {TYPES.map(([k, d]) => (
            <button
              key={k}
              type="button"
              className={`type ${draft.type === k ? "on" : ""}`}
              onClick={() => setDraft({ ...draft, type: k, target: null })}
            >
              <b>{MATCH_TYPE_NAME[k]}</b>
              <span>{d}</span>
            </button>
          ))}
        </div>
        {draft.type === "challenge" ? (
          <WhoPicker target={draft.target} pick={(target) => setDraft({ ...draft, target })} />
        ) : null}
        <div className="seg">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={draft.minutes === d ? "on" : ""}
              onClick={() => setDraft({ ...draft, minutes: d })}
            >
              {d} min
            </button>
          ))}
        </div>
        <div>
          <Btn
            look="go"
            onClick={() => a.open(draft)}
            disabled={draft.type === "challenge" && draft.target === null}
          >
            Open Invite
          </Btn>
        </div>
      </div>
    </div>
  );
};

/** An Invite's seats: its Players, then the seats left (a Lobby always shows one spare). */
const Seats = ({
  m,
  viewer,
  size = 30,
}: {
  readonly m: MatchView;
  readonly viewer: Viewer;
  readonly size?: number;
}) => {
  const empty = m.type === "lobby" ? 1 : m.type === "public" ? 2 - m.players.length : 0;
  return (
    <span className="seats">
      {m.players.map((p) => (
        <span key={p.steamId} className="seat">
          <MarbleIn m={m} steamId={p.steamId} size={size} />
        </span>
      ))}
      {m.type === "challenge" && m.target !== null ? (
        <span
          className={`seat ${m.target.discordId === viewer.discordId ? "you" : ""}`}
          style={{ opacity: 0.55 }}
        >
          <MarbleIn m={m} steamId={m.target.steamId} size={size} />
        </span>
      ) : null}
      {Array.from({ length: Math.max(0, empty) }, (_, i) => (
        <span key={`empty-${i}`} className="seat empty" style={{ width: size, height: size }}>
          +
        </span>
      ))}
    </span>
  );
};

const Top3 = ({ m }: { readonly m: MatchView }) => (
  <div className="t3s">
    {m.standings.slice(0, 3).map((s) => (
      <div key={s.player.steamId} className="t3">
        <span className={rankClass(s.rank)}>{s.rank ?? "–"}</span>
        <MarbleIn m={m} steamId={s.player.steamId} size={18} />
        <span className="n">{nameOf(m)(s.player.discordId)}</span>
        <span>{s.ticks === null ? "—" : formatTime(s.ticks)}</span>
      </div>
    ))}
  </div>
);

const Tile = ({ m, viewer }: { readonly m: MatchView; readonly viewer: Viewer }) => {
  const forYou = m.actions.includes("decline");
  return (
    <div className={`gt ${forYou ? "you" : ""}`}>
      <MapArt m={m} />
      <div className="ov">
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}
        >
          <Chip m={m} />
          {forYou ? <span className="chip you">Challenges you</span> : null}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <div className="mt">{m.map === null ? titleOf(m) : m.map.title}</div>
            <div className="note" style={{ color: "#c9d3f0" }}>
              {m.map === null ? matchDetails(m) : `${titleOf(m)} · ${m.minutes} min`}
            </div>
          </div>
          {m.state === "live" ? <Top3 m={m} /> : <Seats m={m} viewer={viewer} />}
          <div className="row-btns">
            <Offer m={m} tile />
          </div>
        </div>
      </div>
    </div>
  );
};

/** Open Invites soonest to expire first, then live Matches, most recently started first. */
const ordered = (ms: ReadonlyArray<MatchView>) => [
  ...ms.filter((m) => m.state === "invite").sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0)),
  ...ms.filter((m) => m.state === "live").sort((a, b) => startedAt(b) - startedAt(a)),
];

export const Gallery = ({
  viewer,
  matches,
  composing,
  draft,
  setDraft,
}: {
  readonly viewer: Viewer;
  readonly matches: ReadonlyArray<MatchView>;
  readonly composing: boolean;
  readonly draft: Draft;
  readonly setDraft: (d: Draft) => void;
}) => {
  const a = useActions();
  if (matches.length === 0 && !composing)
    return (
      <div className="vE">
        <TopBar viewer={viewer} />
        <div className="emptyb">
          <div className="mt" style={{ fontSize: 24 }}>
            No active Matches
          </div>
          <Btn look="go big" free onClick={a.newMatch}>
            New Match
          </Btn>
        </div>
      </div>
    );
  return (
    <div className="vE">
      <TopBar viewer={viewer} />
      <div className="gal">
        {composing ? (
          <Composer draft={draft} setDraft={setDraft} />
        ) : (
          <button className="gt new" type="button" onClick={a.newMatch}>
            <span className="mt" style={{ fontSize: 22 }}>
              + New Match
            </span>
          </button>
        )}
        {ordered(matches).map((m) => (
          <Tile key={m.matchId} m={m} viewer={viewer} />
        ))}
      </div>
    </div>
  );
};
