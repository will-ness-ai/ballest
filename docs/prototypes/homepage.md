# Homepage design prototype

Branch: `claude/prototype-homepage`. Round 1 is awaiting a verdict. This branch is
a throwaway design reference, never a production implementation or merge candidate.

## Review

Run the current Next app on port 3042 against the dedicated local
`ballest_homepage` database. Open `/?variant=A` through `/?variant=E`.
The draggable picker switches variants with its buttons or the left/right keys;
Desktop and Phone switch between the full page and a 390px iframe. The iframe has
`framed=1` and no nested picker. Existing routes, search, Campaigns and shelves remain.

The data is a real October 15 snapshot imported through the repository writer:
1,457 Maps and 195,806 Entries. It contains one Refresh, so it cannot demonstrate
recent activity or record-age categories. Publication dates and current metrics are real.

## Round 1: featured-area structure

- A, Focused feature: one selected Map, full podium, manual category tabs.
- B, Lead + four: fixed lead Map, full podium, four smaller category picks.
  Secondary picks keep their category metric and world-record time, omitting other
  stats and podiums.
- C, Discovery cards: five equal cards, swipeable on phones. Each keeps all three
  stats and the record holder, omitting second and third places.
- D, Pick a reason: a list of five metric-based choices selects one detailed Map.
- E, Records digest: a compact image-light list. Keeps all three stats and the record
  holder, omitting second and third places.

All remove automatic rotation and keep the prominent Steam picture at or below its
native 400px width. The picker states each variant's omissions. Recommendation: B,
because the alternative picks remain visible beside a clear lead Map.

## Image audit

Five sampled raw Steam previews are 400x270 JPEGs (about 8-20KB). Steam's public
PublishedFileDetails metadata returns that same URL. There is no demonstrated higher
resolution original, and the site adds no thumbnail resize query or image proxy.

The production desktop hero removes the native aspect ratio and forces at least
360px height, which enlarges and crops the preview. Other prominent crops occur in
the Campaign Map header (16:9), Campaign mosaics and rail, Daily background/selector,
and share-image banners. Regular Map cards, player thumbnails and Map panels mostly
preserve 400:270; a wide phone panel may still enlarge its source.

`MapImage` covers most paths. The raw image paths in `BoardTop`, `BoardSheet`,
`CampaignRail`, `MadeTab`, and the OG/share-image route also need consideration in
the implementation. A central component alone cannot fix every path. A sharp large
hero needs a separate creator screenshot or a rendered Map asset.

## Shared category corrections in this prototype

- Barely played -> Fewest players with a time.
- Crowded at the top -> Most players within 1s of WR.
- Most runs -> Most players with a time.
- Author time crushed -> Largest author-time improvement; caption states percentage
  ranking. The later category round should decide whether to show percentage on cards
  as well as, or instead of, seconds below author.
- New this week -> Most played new maps: published in the last seven days, ordered by
  Workshop play sessions. Its See all preset uses the same ordering. Weekly candidates
  are filtered before limiting to 12, including when the browser clock advances.

## Frontier after the structure verdict

Refine the winning feature and its phone layout, then review category copy, grouping
and new categories with another five concrete variants. Suggestions supported by
current Map data:

- Fewest author medals: count of players faster than the author target, ascending.
- Highest author-medal share: author-beating players / players with a time; apply a
  visible minimum board size to avoid a one-player Map always leading.
- Closest to the author target: unbeaten author targets ranked by how little the world
  record still needs to improve, in seconds.
- Longest author times: author target descending, clearly distinguished from record time.
- Most players with a time: a standalone shelf, distinct from Workshop sessions.

History-based ideas for a later round: most new players in seven days and
longest-standing world records. These require actual Score history and clear handling
of backfilled dates ("no later than"). They are not implemented in round 1.

## Validation

Five layouts inspected at 1280px and 390px, no document horizontal overflow; feature
headings, controls and stats fit. Ten JPEG captures live in the primary checkout's
ignored `scratch/homepage-round1/shots/`. Desktop/Phone iframe switching, variant
switching and the actual one-entry Demon 1 podium checked in the browser.
TypeScript, changed-file ESLint and nine Workshop rules tests pass, including weekly
filter-before-limit behavior. Repository-wide check results are recorded in the chat.
