---
name: add-campaign
description: Add a player's Campaign to ballestrecords.com, from their Workshop links, a collection or their profile. Use when someone asks for their run of Workshop Maps on the site as a Campaign.
---

# Add a Campaign

A Campaign (`CONTEXT.md`) is one entry in `CAMPAIGNS` (`web/lib/campaigns.ts`). `docs/site.md`,
"Campaigns", is the reference for the entry, the finder, the board, the page and the Refresh after
merging: read it first. This is the run, from a request to a live page; it takes
`docs/agents/feature-workflow.md`'s small-change path from step 4, with no spec or tickets.

## 1. Draft the entry

From `web/`, run `pnpm --silent campaign draft` on what the request gave, the whole pasted post if
there is one (its `--help` covers the rest). It finds the Maps, labels each as the rail will, and
lists problems (what stops the entry) and notes (what to look at). Done when it prints `problems:
none`, every note is settled below, the rows are in the maker's order (the post's for links, the
collection's for a collection; a maker query lists oldest first, so check that against the series'
titles), the count matches the request (a post saying "8 maps" lists eight), and the title and
slug read well (it names the Campaign by the words its Maps' titles share; `--title` and `--slug`
set them).

- A Map already in a Campaign (a problem), or by someone else (a note), is a question for Will,
  asked on a decision card.
- A Map not on the site yet stays in: step 5's Refresh lists it.
- A label that repeats its number (`01 1 of 8`) is a `mapName` change, test-first: call the Skill
  tool for 'tdd', with the new titles as cases in `web/test/campaigns.test.ts`, and add the
  pattern to the page paragraph of `docs/site.md`, "Campaigns".
- A maker of another Campaign gets a shared constant for their `creator` and `creatorId` at the
  top of `web/lib/campaigns.ts`, as `HABIBAL` is, after step 2 writes the entry.

## 2. Write the entry

Branch `claude/<slug>` from `main` and run the same `draft` with `--write`, which appends the entry
to `CAMPAIGNS`.

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
labels from step 1. Map pictures come from Steam's CDN, which cloud screenshots can't load: blank
pictures there are expected.

Then finish as feature-workflow step 7 says (the Checked lines, `main` merged, ready, and the
merge itself), and send Will the PR and the preview's `/campaign/<slug>` link. Merge on his word.

## 5. After the merge

Run the Refresh, as `docs/site.md` says, and once its run is green run `pnpm --silent campaign
check <slug>` from `web/`. Done when it prints `shown: N of N Maps`. Tell Will
`https://ballestrecords.com/campaign/<slug>`: it is the one to send the maker. Then take
feature-workflow step 8.
