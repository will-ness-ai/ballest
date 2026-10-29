// The link page (/discord/link?t=<token>, ADR 0014): what linkPageOf found for a link request
// Multiballs wrote. Signed out it signs in and comes back; signed in its confirm is a POST, so
// a link preview that opens the page can't use the token; every dead end sends the reader back
// to See my stats. /you's sign-in strip and heading, so it reads as the same site.
import { SteamMark } from "../SteamMark";
import type { LinkPage } from "../../db/stats-link";
import { signInHref, signOutHref, statsLinkConfirmHref, statsLinkHref } from "../../lib/routes";

const AGAIN = "Press See my stats in Discord again for a new link.";

/* the heading and the line under it, for each state */
const HEAD: Record<LinkPage["state"], [string, string]> = {
  "signed-out": ["Pair your Discord account", "So Multiballs can show you your stats."],
  confirm: ["Pair your Discord account", "So Multiballs can show you your stats."],
  done: [
    "Done, your stats are in Discord",
    "Your card shows in Discord in a few seconds. From now on, See my stats shows it at once.",
  ],
  bad: ["This link doesn't work", AGAIN],
  expired: ["This link has expired", "A link lasts 15 minutes. " + AGAIN],
  used: ["This link has already been used", AGAIN],
};

export function LinkView({ page, token }: { page: LinkPage; token: string }) {
  const [title, line] = HEAD[page.state];
  const here = statsLinkHref(token);
  return (
    <section className="ys sl">
      <header>
        <h1>{title}</h1>
        <p className="ys-line">{line}</p>
      </header>
      {page.state === "signed-out" && (
        <div className="ys-in">
          <span className="ys-in-mark">
            <SteamMark />
          </span>
          <p>
            <b>Sign in with Steam</b> to pair Discord account <b>{page.discord}</b> with your Steam
            account.
          </p>
          <a className="ys-go" href={signInHref(here)}>
            Sign in
          </a>
        </div>
      )}
      {page.state === "confirm" && (
        <>
          <form className="ys-in" method="post" action={statsLinkConfirmHref(token)}>
            <span className="ys-in-mark">
              <SteamMark />
            </span>
            <p>
              Pair Discord account <b>{page.discord}</b> with <b>{page.persona}</b>?
            </p>
            <button type="submit" className="ys-go">
              Pair
            </button>
          </form>
          <form method="post" action={signOutHref(here)}>
            <button type="submit" className="sl-not">
              Not you? Sign in as someone else
            </button>
          </form>
        </>
      )}
    </section>
  );
}
