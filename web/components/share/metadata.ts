// A page's metadata naming its share image (lib/share.ts, docs/site.md "Share images").
import type { Metadata } from "next";

import { getSite } from "../../db/data";
import { SITE_NAME, pageTitle } from "../../lib/rules";
import { shareHref } from "../../lib/routes";
import type { ShareKind } from "../../lib/share";

/* A page's metadata with its own share image, named by the latest Refresh so each Refresh
   is a new URL to crawlers. Next replaces the layout's openGraph rather than merging into
   it, so the site name and type are restated here. metadataBase is the production address,
   so a preview deploy names its own card with an absolute URL, or its links would unfurl
   production's (or nothing, for a page production lacks). */
export async function shareMetadata(
  m: { title: string; description: string },
  card: { kind: ShareKind; id: string; alt: string },
): Promise<Metadata> {
  const host =
    process.env.VERCEL_ENV === "preview"
      ? (process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL)
      : undefined;
  const url =
    (host ? "https://" + host : "") + shareHref(card.kind, card.id, (await getSite()).asOf);
  return {
    ...m,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: pageTitle(m.title),
      description: m.description,
      images: [{ url, width: 1200, height: 630, alt: card.alt }],
    },
    twitter: { card: "summary_large_image", images: [url] },
  };
}
