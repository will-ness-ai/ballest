// A player's name as a link to their page on this site; the link out to Steam lives there.
// No state, so server and client components both use it.
import Link from "next/link";

import { playerHref } from "../lib/routes";
import { isSteamId } from "../lib/rules";

/* Only a plain Steam64 is ever linked, and anything else renders as flat text. `tab` opens
   their page on that tab. */
export function PlayerLink({ id, text, tab }: { id: string | null; text: string; tab?: string }) {
  return isSteamId(id) ? <Link href={playerHref(id, tab)}>{text}</Link> : <>{text}</>;
}
