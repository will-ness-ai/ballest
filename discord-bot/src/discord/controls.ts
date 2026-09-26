// What a clicked button or submitted form asks for, and the custom id that carries it. Discord
// hands the id back on every click, so choices made so far ride along in it: one table below
// says how each kind of Control is written and read, so the two can't drift apart.
import { DURATIONS, type MatchType, type Minutes } from "../domain.js"
import type { InviteRequest } from "../engine.js"

export type Action = "accept" | "decline" | "join" | "leave" | "start" | "cancel"

export type Control =
  | { readonly _tag: "NewMatch" }
  | { readonly _tag: "LinkSteam" }
  | { readonly _tag: "PickType"; readonly type: MatchType }
  | { readonly _tag: "PickTarget" }
  /** A length was picked; the Invite isn't open yet. */
  | { readonly _tag: "PickDuration"; readonly request: InviteRequest }
  | { readonly _tag: "OpenInvite"; readonly request: InviteRequest }
  | { readonly _tag: "Act"; readonly action: Action; readonly matchId: string }
  | { readonly _tag: "ConfirmLink" }
  | { readonly _tag: "LinkForm" }

type Tag = Control["_tag"]
type Of<K extends Tag> = Extract<Control, { readonly _tag: K }>

interface Codec<K extends Tag> {
  readonly prefix: string
  write(c: Of<K>): ReadonlyArray<string>
  /** Null when the fields don't make a valid Control (an id from an older build, say). */
  read(fields: ReadonlyArray<string | undefined>): Of<K> | null
}

const ACTIONS: ReadonlyArray<Action> = ["accept", "decline", "join", "leave", "start", "cancel"]
const TYPES: ReadonlyArray<MatchType> = ["public", "challenge", "lobby"]
const NO_TARGET = "-"

const typeOf = (s: string | undefined) => TYPES.find((t) => t === s)
const minutesOf = (s: string | undefined): Minutes | undefined => DURATIONS.find((d) => String(d) === s)

const writeRequest = (r: InviteRequest) => [r.type, r.target ?? NO_TARGET, String(r.minutes)]
const readRequest = ([type, target, minutes]: ReadonlyArray<string | undefined>): InviteRequest | null => {
  const t = typeOf(type)
  const m = minutesOf(minutes)
  if (t === undefined || m === undefined || target === undefined) return null
  return { type: t, target: target === NO_TARGET ? null : target, minutes: m }
}

const bare = <K extends Tag>(prefix: string, control: Of<K>): Codec<K> => ({ prefix, write: () => [], read: () => control })

const CODECS: { readonly [K in Tag]: Codec<K> } = {
  NewMatch: bare("new", { _tag: "NewMatch" }),
  LinkSteam: bare("link", { _tag: "LinkSteam" }),
  PickTarget: bare("target", { _tag: "PickTarget" }),
  ConfirmLink: bare("linkyes", { _tag: "ConfirmLink" }),
  LinkForm: bare("linkform", { _tag: "LinkForm" }),
  PickType: {
    prefix: "type",
    write: (c) => [c.type],
    read: ([type]) => {
      const t = typeOf(type)
      return t === undefined ? null : { _tag: "PickType", type: t }
    }
  },
  PickDuration: {
    prefix: "dur",
    write: (c) => writeRequest(c.request),
    read: (fields) => {
      const request = readRequest(fields)
      return request === null ? null : { _tag: "PickDuration", request }
    }
  },
  OpenInvite: {
    prefix: "open",
    write: (c) => writeRequest(c.request),
    read: (fields) => {
      const request = readRequest(fields)
      return request === null ? null : { _tag: "OpenInvite", request }
    }
  },
  Act: {
    prefix: "act",
    write: (c) => [c.action, c.matchId],
    read: ([action, matchId]) => {
      const a = ACTIONS.find((x) => x === action)
      return a === undefined || matchId === undefined || matchId === "" ? null : { _tag: "Act", action: a, matchId }
    }
  }
}

const NAMESPACE = "mb"

const codecOf = <K extends Tag>(tag: K): Codec<K> => CODECS[tag]

export const controlId = (c: Control): string => {
  const codec: Codec<Tag> = codecOf(c._tag)
  return [NAMESPACE, codec.prefix, ...codec.write(c)].join(":")
}

/** The Control a custom id carries, or null for an id that isn't one of ours. */
export const parseControl = (id: string): Control | null => {
  const [namespace, prefix, ...fields] = id.split(":")
  if (namespace !== NAMESPACE) return null
  const readers: ReadonlyArray<Pick<Codec<Tag>, "prefix" | "read">> = Object.values(CODECS)
  const codec = readers.find((c) => c.prefix === prefix)
  return codec === undefined ? null : codec.read(fields)
}
