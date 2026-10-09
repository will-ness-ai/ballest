import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "../lib/routes";

// /robots.txt. Crawlers may read every page that stands on its own, but not the views of
// one: a player's tabs, a board or Map focused on a player, a head to head, or the JSON
// the pages fetch. With some 15,000 players those multiply into hundreds of thousands of
// URLs, each a server render, and on 2026-10-08 GPTBot and ClaudeBot began walking all of
// them. The share images stay open, since link previews read them.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/player/*/", "/board/*/", "/map/*/", "/vs/", "/api/"],
    },
    host: SITE_ORIGIN,
  };
}
