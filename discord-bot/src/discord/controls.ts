// What a clicked button or submitted form asks for, and the custom id that carries it. Discord
// hands the id back on every click, so choices made so far ride along in it: one table below
// says how each kind of Control is written and read, so the two can't drift apart.
import { type Action, ACTIONS, DURATIONS, type MatchType, type Minutes } from "../domain.js";
import type { InviteRequest } from "../engine.js";

export type { Action };

export type Control =
  | { readonly _tag: "NewMatch" }
  | { readonly _tag: "LinkSteam" }
  | { readonly _tag: "PickType"; readonly type: MatchType }
  | { readonly _tag: "PickTarget" }
  /** A length was picked; the Invite isn't open yet. */
  | { readonly _tag: "PickDuration"; readonly request: InviteRequest }
  | { readonly _tag: "OpenInvite"; readonly request: InviteRequest }
  | { readonly _tag: "Act"; readonly action: Action; readonly matchId: string }
  /** Leave on a live Card: asks first, privately. */
  | { readonly _tag: "AskLeave"; readonly matchId: string }
  | { readonly _tag: "ConfirmLeave"; readonly matchId: string }
  /** Play again on a finished Match: opens its Lobby, or joins the one already opened. */
  | { readonly _tag: "PlayAgain"; readonly matchId: string }
  | { readonly _tag: "Stay" }
  | { readonly _tag: "ConfirmLink" }
  | { readonly _tag: "LinkForm" }
  /** The Footer's Pings button: shows the member, privately, whether they have the ping role. */
  | { readonly _tag: "Pings" }
  /** Get (on) or Remove (off) the ping role, on the Pings reply or the offer. */
  | { readonly _tag: "SetPing"; readonly on: boolean }
  /** No, on the offer of the ping role. */
  | { readonly _tag: "DeclinePing" }
  /** The My Stats panel's button: the member's Stat Card, privately. */
  | { readonly _tag: "SeeMyStats" }
  /** "Not you? Pair again", on the Stat Card's private answer: a fresh sign-in link. */
  | { readonly _tag: "PairAgain" }
  /** The Weekly Cup's post (spec #353): each button names its server and its week's Monday. */
  | CupControl<"CupSignUp">
  | CupControl<"CupWithdraw">
  /** Skip on the post: asks a server admin to confirm, privately. */
  | CupControl<"CupSkip">
  | CupControl<"CupConfirmSkip">
  /** The Shortlist's vote: a pick of up to 3 of its Maps. */
  | CupControl<"CupVote">;

type CupTag = "CupSignUp" | "CupWithdraw" | "CupSkip" | "CupConfirmSkip" | "CupVote";
interface CupControl<K extends CupTag> {
  readonly _tag: K;
  readonly guildId: string;
  readonly week: string;
}

type Tag = Control["_tag"];
type Of<K extends Tag> = Extract<Control, { readonly _tag: K }>;

interface Codec<K extends Tag> {
  readonly prefix: string;
  write(c: Of<K>): ReadonlyArray<string>;
  /** Null when the fields don't make a valid Control (an id from an older build, say). */
  read(fields: ReadonlyArray<string | undefined>): Of<K> | null;
}

const TYPES: ReadonlyArray<MatchType> = ["public", "challenge", "lobby"];
const NO_TARGET = "-";

const typeOf = (s: string | undefined) => TYPES.find((t) => t === s);
const minutesOf = (s: string | undefined): Minutes | undefined =>
  DURATIONS.find((d) => String(d) === s);

const writeRequest = (r: InviteRequest) => [r.type, r.target ?? NO_TARGET, String(r.minutes)];
const readRequest = ([type, target, minutes]: ReadonlyArray<
  string | undefined
>): InviteRequest | null => {
  const t = typeOf(type);
  const m = minutesOf(minutes);
  if (t === undefined || m === undefined || target === undefined) return null;
  return { type: t, target: target === NO_TARGET ? null : target, minutes: m };
};

const bare = <K extends Tag>(prefix: string, control: Of<K>): Codec<K> => ({
  prefix,
  write: () => [],
  read: () => control,
});

const matchIdOf = (s: string | undefined) => (s === undefined || s === "" ? null : s);

/** A Control that carries only a Match id. */
const forMatch = <K extends "AskLeave" | "ConfirmLeave" | "PlayAgain">(
  prefix: string,
  make: (matchId: string) => Of<K>,
): Codec<K> => ({
  prefix,
  write: (c: { readonly matchId: string }) => [c.matchId],
  read: ([id]) => {
    const matchId = matchIdOf(id);
    return matchId === null ? null : make(matchId);
  },
});

const WEEK = /^\d{4}-\d{2}-\d{2}$/;

/** A Weekly Cup Control: its server's id and its week. */
const forCup = <K extends CupTag>(prefix: string, tag: K): Codec<K> => ({
  prefix,
  write: (c: CupControl<CupTag>) => [c.guildId, c.week],
  read: ([guildId, week]) =>
    guildId === undefined || guildId === "" || week === undefined || !WEEK.test(week)
      ? null
      : ({ _tag: tag, guildId, week } as Of<K>),
});

const CODECS: { readonly [K in Tag]: Codec<K> } = {
  CupSignUp: forCup("cupin", "CupSignUp"),
  CupWithdraw: forCup("cupout", "CupWithdraw"),
  CupSkip: forCup("cupskip", "CupSkip"),
  CupConfirmSkip: forCup("cupskipyes", "CupConfirmSkip"),
  CupVote: forCup("cupvote", "CupVote"),
  NewMatch: bare("new", { _tag: "NewMatch" }),
  LinkSteam: bare("link", { _tag: "LinkSteam" }),
  PickTarget: bare("target", { _tag: "PickTarget" }),
  ConfirmLink: bare("linkyes", { _tag: "ConfirmLink" }),
  LinkForm: bare("linkform", { _tag: "LinkForm" }),
  Stay: bare("stay", { _tag: "Stay" }),
  Pings: bare("pings", { _tag: "Pings" }),
  DeclinePing: bare("pingno", { _tag: "DeclinePing" }),
  SeeMyStats: bare("stats", { _tag: "SeeMyStats" }),
  PairAgain: bare("statsagain", { _tag: "PairAgain" }),
  SetPing: {
    prefix: "setping",
    write: (c) => [c.on ? "on" : "off"],
    read: ([on]) =>
      on === "on"
        ? { _tag: "SetPing", on: true }
        : on === "off"
          ? { _tag: "SetPing", on: false }
          : null,
  },
  AskLeave: forMatch("quit", (matchId) => ({ _tag: "AskLeave", matchId })),
  ConfirmLeave: forMatch("quityes", (matchId) => ({ _tag: "ConfirmLeave", matchId })),
  PlayAgain: forMatch("again", (matchId) => ({ _tag: "PlayAgain", matchId })),
  PickType: {
    prefix: "type",
    write: (c) => [c.type],
    read: ([type]) => {
      const t = typeOf(type);
      return t === undefined ? null : { _tag: "PickType", type: t };
    },
  },
  PickDuration: {
    prefix: "dur",
    write: (c) => writeRequest(c.request),
    read: (fields) => {
      const request = readRequest(fields);
      return request === null ? null : { _tag: "PickDuration", request };
    },
  },
  OpenInvite: {
    prefix: "open",
    write: (c) => writeRequest(c.request),
    read: (fields) => {
      const request = readRequest(fields);
      return request === null ? null : { _tag: "OpenInvite", request };
    },
  },
  Act: {
    prefix: "act",
    write: (c) => [c.action, c.matchId],
    read: ([action, id]) => {
      const a = ACTIONS.find((x) => x === action);
      const matchId = matchIdOf(id);
      return a === undefined || matchId === null ? null : { _tag: "Act", action: a, matchId };
    },
  },
};

const NAMESPACE = "mb";

const codecOf = <K extends Tag>(tag: K): Codec<K> => CODECS[tag];

export const controlId = (c: Control): string => {
  const codec: Codec<Tag> = codecOf(c._tag);
  return [NAMESPACE, codec.prefix, ...codec.write(c)].join(":");
};

/** The Control a custom id carries, or null for an id that isn't one of ours. */
export const parseControl = (id: string): Control | null => {
  const [namespace, prefix, ...fields] = id.split(":");
  if (namespace !== NAMESPACE) return null;
  const readers: ReadonlyArray<Pick<Codec<Tag>, "prefix" | "read">> = Object.values(CODECS);
  const codec = readers.find((c) => c.prefix === prefix);
  return codec === undefined ? null : codec.read(fields);
};
