import type { NextConfig } from "next";

// Phase 0 of docs/nextjs-migration.md: Next serves the existing static page from
// public/ (scripts/sync-site.mjs), so every URL answers as it does on GitHub Pages.
// Files in public/ are served as they are; these rewrites cover the directory URLs
// Pages answers with an index.html, and the extensionless .html it also serves.
// trailingSlash matches Pages too: /leth redirects to /leth/, which its page needs
// because it loads data/ relatively. File URLs keep no slash.
const config: NextConfig = {
  trailingSlash: true,
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/index.html" },
        { source: "/leth/", destination: "/leth/index.html" },
        { source: "/multiballs/:page(terms|privacy)/", destination: "/multiballs/:page.html" },
      ],
    };
  },
};

export default config;
