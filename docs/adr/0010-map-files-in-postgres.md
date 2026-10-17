# Map files are stored in Postgres

Status: accepted (2026-10-17).

The site draws every Workshop Map in 3D (spec #250), so it needs each Map's file, the
.ballmap the editor saves. Steam serves it only through its content servers (QueryFiles
gives this app no `file_url`), which a browser or a Vercel function can't reach cheaply, so
the collector downloads each file and keeps a copy: after each Refresh, every Map whose file
is new or changed (by the catalogue's `hcontent_file`), within a time budget.

The copies go in the same Postgres as everything else, one row per Map in `map_files`, the
file gzip-compressed as bytes beside its version and raw size. The collector writes the
table and the site only reads it, as with `ghosts` (ADR 0005); only the current version of a
file is kept. Measured 2026-10-17: 1,521 Maps, 454 MB raw (median 71 KB, largest 48 MB),
and the JSON compresses about 29 times, so about 16 MB stored. At that size the reasons ADR
0009 gave for Prefabs hold: one store, one backup story (a Neon snapshot covers the files
with the scores), and one connection for the collector, which already writes there.

## Considered Options

- Vercel Blob: cheaper per byte and served from the CDN directly, but a second store to
  keep in step with the database and a second token in the collector, for 16 MB. The site
  serves each stored file with a long cache keyed by its version, so the CDN still carries
  the traffic.
- The repo: the collector commits nothing since the move to Postgres (ADR 0005), and
  committing files on every Refresh would bring back the churn that move removed.
