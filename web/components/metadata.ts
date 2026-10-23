// A page's metadata: its title and description, its canonical address, and its share
// image if it has one (lib/share.ts, docs/site.md "Share images").
import type { Metadata } from "next";

import { getSite } from "../db/data";
import { SITE_NAME, pageTitle } from "../lib/rules";
import { shareHref } from "../lib/routes";
import type { ShareKind } from "../lib/share";

/* `canonical` is the page's own path (lib/routes.ts), without the view a URL may add (a
   player's tab, a focused row), resolved against metadataBase. A page with no card keeps
   the layout's og.png.

   A card is named by the latest Refresh so each Refresh is a new URL to crawlers (a
   Prefab's by its last edit too, if that is later). Next
   replaces the layout's openGraph rather than merging into it, so the site name and type
   are restated here. metadataBase is the production address, so a preview deploy names
   its own card with an absolute URL, or its links would unfurl production's (or nothing,
   for a page production lacks). */
export async function pageMetadata(
  m: { title: string; description: string; canonical: string },
  /* `at`, when the page itself last changed (ms), names the card anew when that is after
     the latest Refresh: a Prefab's edit */
  card?: { kind: ShareKind; id: string; alt: string; at?: number },
): Promise<Metadata> {
  const { title, description, canonical } = m;
  const page = { title, description, alternates: { canonical } };
  if (!card) return page;
  const host =
    process.env.VERCEL_ENV === "preview"
      ? (process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL)
      : undefined;
  const url =
    (host ? "https://" + host : "") +
    shareHref(card.kind, card.id, Math.max((await getSite()).asOf, card.at ?? 0));
  return {
    ...page,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: pageTitle(title),
      description,
      url: canonical,
      images: [{ url, width: 1200, height: 630, alt: card.alt }],
    },
    twitter: { card: "summary_large_image", images: [url] },
  };
}
