import type { MetadataRoute } from "next";

import { SITE_ORIGIN, sitemapHref } from "../lib/routes";

// /robots.txt. Crawlers may read every page that stands on its own, but not the views of
// one: a player's tabs, a board or Map focused on a player, an Overall board in podium
// order, a Campaign's Map (the Map has its own page), a head to head, the JSON the pages
// fetch, or the Prefab upload form. With some 15,000 players those multiply into hundreds of
// thousands of URLs, each a server render, and on 2026-10-08 GPTBot and ClaudeBot began
// walking all of them. Nor the link page Multiballs
// sends a player to, which only a link request's token opens (ADR 0014). The share images
// stay open, since link previews read them. The sitemap lists the pages worth a search
// result (lib/sitemap.ts).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/player/*/",
        "/board/*/",
        "/campaign/*/",
        "/map/*/",
        "/vs/",
        "/api/",
        "/prefabs/new",
        "/discord/",
      ],
    },
    sitemap: SITE_ORIGIN + sitemapHref(),
  };
}
