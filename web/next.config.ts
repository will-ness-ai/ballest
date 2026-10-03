import type { NextConfig } from "next";

// Phase 0 of docs/nextjs-migration.md: Next serves the existing static page from
// public/ (scripts/sync-site.mjs), so every URL answers as it does on GitHub Pages.
// Files in public/ are served as they are; these rewrites cover the directory URLs
// Pages answers with an index.html, and the extensionless .html it also serves.
// Next's own trailing-slash redirect is off because Pages has none: /leth gains
// its slash in proxy.ts, and nothing else changes shape.
const config: NextConfig = {
  skipTrailingSlashRedirect: true,
  rewrites() {
    return Promise.resolve({
      beforeFiles: [
        { source: "/", destination: "/index.html" },
        { source: "/leth/", destination: "/leth/index.html" },
        { source: "/multiballs/:page(terms|privacy)", destination: "/multiballs/:page.html" },
      ],
    });
  },
};

export default config;
