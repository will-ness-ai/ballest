import type { NextConfig } from "next";

// The site is the App Router app in app/ (docs/site.md). cacheComponents makes every page
// static until the read layer's cache tag expires (db/data.ts), and partialPrefetching
// serves a page whose params weren't prerendered (a player, a Map) from its App Shell at
// once, then caches it whole. The other files Pages served live in public/
// (scripts/sync-site.mjs); these rewrites cover the directory URLs Pages answered with an
// index.html, and the extensionless .html it also served. Next's own trailing-slash
// redirect is off because Pages had none: /leth gains its slash in proxy.ts.
const config: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  skipTrailingSlashRedirect: true,
  // the share images read their fonts and Track pictures from disk (components/share)
  outputFileTracingIncludes: { "/og/**": ["./assets/share/**"] },
  rewrites() {
    return Promise.resolve({
      beforeFiles: [
        { source: "/leth/", destination: "/leth/index.html" },
        { source: "/multiballs/:page(terms|privacy)", destination: "/multiballs/:page.html" },
      ],
    });
  },
};

export default config;
