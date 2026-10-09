// The sign-in cookies' names (ADR 0008), here rather than in session.ts so the browser can
// read them without pulling in node:crypto.

/* httpOnly: the signed session */
export const SESSION_COOKIE = "ballest-session";
/* readable, holding only "1": a session exists, so the browser knows to ask /api/me */
export const HINT_COOKIE = "ballest-in";
/* httpOnly, for ten minutes: ties Steam's answer to the browser that went to sign in */
export const STATE_COOKIE = "ballest-signin";
