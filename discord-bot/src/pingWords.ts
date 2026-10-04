// What Lobby pings say, on both surfaces: the channel's Pings reply and offer
// (discord/messages.ts) and the Activity's bell, toasts and offer (activity/web/). Each text that
// names the role takes it as `role`: the channel passes a real role mention (`<@&id>`) where it
// can, the Activity passes the role's name (`Pings.role`, "@Multiplayer ping", read from the
// server so a renamed role reads right). Buttons can't hold a mention, so their labels use the name.
// Pure, and free of Node, so the page's bundle uses it as it is.

/** The Footer button's label, which the texts send members back to. */
export const PINGS_LABEL = "Pings";

/** "Lobby pings: on" / "Lobby pings: off": the Pings reply's heading and the bell's tooltip. */
export const pingsState = (on: boolean) => `Lobby pings: ${on ? "on" : "off"}`;

/** Under the heading: "You have <role>." / "You don't have <role>." */
export const pingsHave = (on: boolean, role: string) =>
  on ? `You have ${role}.` : `You don't have ${role}.`;

/** The toast's button that takes the bell's change back. */
export const UNDO_PING = "Undo";

/** The button that turns it on: on the Pings reply when off, and on the offer. */
export const getPing = (role: string) => `Get ${role}`;
/** The button that turns it off, on the Pings reply when on. */
export const removePing = (role: string) => `Remove ${role}`;
/** The offer's other answer. */
export const DECLINE_PING = "No";

/** The offer, after a member's first Join or Accept. `pings` is how the Pings button is written: bold in the channel. */
export const pingOffer = (role: string, pings: string = PINGS_LABEL) =>
  `Get ${role} to hear when someone opens a Lobby. Change it later from ${pings}.`;

/** What the offer becomes after No. */
export const pingDeclined = (pings: string = PINGS_LABEL) =>
  `${pingsState(false)}. Change it later from ${pings}.`;

/** Discord refused to change the role. */
export const pingFailed = (role: string) => `Discord didn't change ${role}. Try again in a moment.`;

/** Discord didn't say whether the member has the role: only a read failed, nothing was changed. */
export const pingUnread = (role: string) =>
  `Discord didn't say whether you have ${role}. Try again in a moment.`;
