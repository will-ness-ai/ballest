import type { NextConfig } from "next";

// Phase 0 of docs/nextjs-migration.md: Next serves the existing static page from
// public/ (scripts/sync-site.mjs), so every URL answers as it did on GitHub Pages.
// Files in public/ are served as they are; these rewrites cover the directory URLs
// Pages answered with an index.html, and the extensionless .html it also served.
// Next's own trailing-slash redirect is off because Pages had none: /leth gains
// its slash in proxy.ts, and nothing else changes shape.
const config: NextConfig = {
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/index.html" },
        { source: "/leth/", destination: "/leth/index.html" },
        { source: "/multiballs/:page(terms|privacy)", destination: "/multiballs/:page.html" },
      ],
    };
  },
};

export default config;
