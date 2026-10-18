---
name: add-campaign
description: Add a player's Campaign to ballestrecords.com, from their Workshop links, a collection or their profile. Use when someone asks for their run of Workshop Maps on the site as a Campaign.
---

# Add a Campaign

A Campaign (`CONTEXT.md`) is one entry in `CAMPAIGNS` (`web/lib/campaigns.ts`). `docs/site.md`,
"Campaigns", is the reference for the entry, the finder, the board, the page and the Refresh after
merging: read it first. This is the run, from a request to a live page; it takes
`docs/agents/feature-workflow.md`'s small-change path from step 4, with no spec or tickets.

## 1. Find the Maps

Run `tools/workshop_maps.py` on what the request gave, the whole pasted post if there is one. Done
when it ends with the `maps:` line and every Map is by the one maker, in no other Campaign, in the
maker's order (the post's for links, the collection's for a collection; a maker query prints
oldest first, so check that against the series' titles), and the count matches the request (a post
saying "8 maps" lists eight). A Map by someone else, or already in a Campaign, is a question for
Will, asked on a decision card. A Map the site doesn't list yet stays in: step 5's Refresh lists
it.

## 2. Write the entry

Branch `claude/<slug>` from `main`, then append the entry to `CAMPAIGNS` with the five fields
`docs/site.md` lists: `title` as the maker names the series, `creator` and `creatorId` from step
1's output, `maps` from its `maps:` line (a maker of several Campaigns is a shared constant at the
top).

Then read each Map's title through `mapLabel`, as the rail will. Done when every label reads
cleanly (`01 Mercury`, or `01` for a title that is only its number) and none repeats the number
(`01 1 of 8`). A title pattern that reads badly is a `mapName` change, test-first: call the Skill
tool for 'tdd', with the new titles as cases in `web/test/campaigns.test.ts`, and add the pattern
to the page paragraph of `docs/site.md`, "Campaigns".

## 3. Open and review the PR

Run `pnpm check` at the root, then in `web/` `npx tsc --noEmit` and `npx vitest run
test/campaigns.test.ts`. Push, and open a draft PR titled `Campaigns: add <title> by <maker>` with
`.github/pull_request_template.md`'s sections. Then review it, a one-entry PR included. Call the
Skill tool for 'code-review' on the branch against `main`. Call the Skill tool for
'codebase-design' on the code the branch touched. Fix what they find, re-reviewing as
feature-workflow step 5 says.

## 4. Look at the page

Shoot the new Campaign's page on the PR's preview at both widths, as `docs/site.md` says. Done
when both pictures show the Campaign's name, the maker and every Map the site lists, with the
labels from step 2. Map pictures come from Steam's CDN, which cloud screenshots can't load: blank
pictures there are expected.

Then finish as feature-workflow step 7 says (the Checked lines, `main` merged, ready), and send
Will the PR and the preview's `/campaign/<slug>` link. Merge on his word, as step 7 says.

## 5. After the merge

Run the Refresh, as `docs/site.md` says, and once its run is green check the page. Done when
`https://ballestrecords.com/campaign/<slug>` shows every Map of the Campaign. Tell Will that link:
it is the one to send the maker. Then take feature-workflow step 8.
