---
name: add-campaign
description: Add a player's Campaign to ballestrecords.com, from their Workshop links, a collection or their profile. Use when someone asks for their run of Workshop Maps on the site as a Campaign.
---

# Add a Campaign

A Campaign (`CONTEXT.md`) is one entry in `CAMPAIGNS` (`web/lib/campaigns.ts`); the pages are
prerendered from it. `docs/site.md`, "Campaigns", is the reference for the entry's fields, the
board and the page: read it first. This is the run, from a request to a live page.

## 1. Find the Maps

`python tools/workshop_maps.py <query ...>` with what the request gave: the whole pasted post,
the Workshop links or IDs, a collection, or the maker (profile URL, SteamID64 or name). Keep the
maker's order: the post's order for links, the collection's for a collection.

Done when it ends with the `maps:` line and every Map is by the one maker, in no other Campaign,
and the count matches the request (a post saying "8 maps" lists eight). A Map by someone else, or
already in a Campaign, is a question for Will, asked on a decision card. A Map marked as one the
site doesn't list yet stays in: step 5's Refresh lists it.

## 2. Write the entry

Branch `claude/<slug>` from `main`, then append the entry to `CAMPAIGNS` (append, so the others
keep their place): `slug` from the title, `title` as the maker names the series, `creator` and
`creatorId` from step 1's output (a maker of several Campaigns is a shared constant at the top).

Then read each Map's title through `mapLabel`: the rail shows the Map's number, then its title
after the Campaign's name. Done when every label reads cleanly (`01 Mercury`, or `01` for a title
that is only its number) and none repeats the number (`01 1 of 8`). A title pattern that reads
badly is a `mapName` change, test-first: call the Skill tool for 'tdd', with the new titles as
cases in `web/test/campaigns.test.ts`.

## 3. Check and open the PR

`pnpm check` at the root, then in `web/`: `npx tsc --noEmit` and
`npx vitest run test/campaigns.test.ts`. Commit, push and open a draft PR (title
`Campaigns: add <title> by <maker>`); its Before/After names the Campaign and its Map count.

Then review it, a one-entry PR included. Call the Skill tool for 'code-review' on the branch
against `main`. Call the Skill tool for 'codebase-design' on the code the branch touched. Fix
what they find in one commit.

## 4. Look at the page

Once the PR's Vercel preview is built, `pnpm --silent qa shot /campaign/<slug>@1280` and `@390`
from `web/`. Done when both pictures show the Campaign's name, the maker and every Map the site
lists, with the labels from step 2. Map pictures come from Steam's CDN, which cloud screenshots
can't load: blank pictures there are expected.

Mark the PR ready, and send Will the PR and the preview's `/campaign/<slug>` link. Merge on his
word, squash only (`docs/agents/feature-workflow.md`, step 8).

## 5. After the merge

`gh workflow run refresh.yml --ref main`, then open `https://ballestrecords.com/campaign/<slug>`
once the run is green. Done when production shows every Map of the Campaign. Tell Will the live
link: it is the one to send the maker.
