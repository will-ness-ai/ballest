// The cache tags the cached reads (data.ts) carry, so a write expires only what it changed.

/* every read of the boards, expired by each Refresh (POST /api/revalidate) */
export const DATA_TAG = "data";

/* the Daily reads, expired as well by each Daily read (GLOSSARY.md), which changes only the
   open Dailies */
export const DAILY_TAG = "dailies";

/* one board's reads, so a Daily read expires its own board's and no other */
export const boardTag = (name: string) => `board:${name}`;
