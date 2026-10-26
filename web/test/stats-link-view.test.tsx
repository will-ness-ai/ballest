// The link page as drawn (components/discord/LinkView): signed out it signs in and comes back,
// signed in its confirm is a POST (so a link preview can't use the token) beside "Not you?",
// which signs out and comes back, and every dead end sends the reader back to Discord.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { LinkView } from "../components/discord/LinkView";
import type { LinkPage } from "../db/stats-link";
import { signInHref, signOutHref, statsLinkConfirmHref, statsLinkHref } from "../lib/routes";

const TOKEN = "0123456789abcdef0123456789abcdef";
const PAGE = statsLinkHref(TOKEN);
const draw = (page: LinkPage) => renderToStaticMarkup(<LinkView page={page} token={TOKEN} />);
const amp = (href: string) => href.replaceAll("&", "&amp;");
/* whether `html` holds a form that POSTs to `href` */
const posts = (html: string, href: string) =>
  [...html.matchAll(/<form [^>]*>/g)].some(
    ([tag]) => tag.includes('method="post"') && tag.includes(`action="${amp(href)}"`),
  );

test("signed out, Sign in with Steam comes back to the link page", () => {
  const html = draw({ state: "signed-out", discord: "ada.disc" });
  expect(html).toContain("ada.disc");
  expect(html).toContain(`href="${amp(signInHref(PAGE))}"`);
  expect(html).not.toContain("<form");
});

test("signed in, the confirm is a POST naming both accounts, and Not you signs out", () => {
  const html = draw({ state: "confirm", discord: "ada.disc", steamId: "1", persona: "Ada" });
  expect(html).toMatch(/Pair Discord account <b>ada\.disc<\/b> with <b>Ada<\/b>/);
  expect(posts(html, statsLinkConfirmHref(TOKEN))).toBe(true);
  expect(posts(html, signOutHref(PAGE))).toBe(true);
  expect(html).toContain("Not you? Sign in as someone else");
});

test("done says the stats are in Discord", () => {
  expect(draw({ state: "done" })).toContain("Done, your stats are in Discord");
});

test("a bad, expired or used link says so and to press See my stats again", () => {
  for (const state of ["bad", "expired", "used"] as const) {
    const html = draw({ state });
    expect(html, state).toContain("See my stats");
    expect(html, state).not.toContain("<form");
  }
  expect(draw({ state: "expired" })).toContain("expired");
  expect(draw({ state: "used" })).toContain("already been used");
});
