// A page's metadata naming its share image (lib/share.ts, docs/site.md "Share images").
import type { Metadata } from "next";

import { pageTitle } from "../../lib/rules";
import { SITE_NAME } from "../../lib/share";

/* A page's metadata with its own share image. Next replaces the layout's openGraph rather
   than merging into it, so the site name and type are restated here. metadataBase is the
   production address, so a preview deploy names its own card with an absolute URL, or its
   links would unfurl production's (or nothing, for a page production lacks). */
export function shareMetadata(
  m: { title: string; description: string },
  image: string,
  alt: string,
): Metadata {
  const host = process.env.VERCEL_ENV === "preview" ? process.env.VERCEL_BRANCH_URL : undefined;
  const url = (host ? "https://" + host : "") + image;
  return {
    ...m,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: pageTitle(m.title),
      description: m.description,
      images: [{ url, width: 1200, height: 630, alt }],
    },
    twitter: { card: "summary_large_image", images: [url] },
  };
}
