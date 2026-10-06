# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

## Cloud sessions

Cloud sessions use `gh` too, in preference to the GitHub MCP tools. There `gh` reaches
only GitHub's REST API: GraphQL is blocked, so `gh issue list`, `gh pr view` and the other
porcelain commands fail. Use `gh api` with the REST equivalent:

- **List / read**: `gh api repos/will-ness-ai/ballest/issues?state=open` (PRs appear here too;
  `pulls` lists only PRs), `gh api repos/will-ness-ai/ballest/issues/<n>` and
  `.../issues/<n>/comments`.
- **Create / comment / label / close**: `gh api -X POST .../issues -f title=... -f body=...`,
  `gh api -X POST .../issues/<n>/comments -f body=...`,
  `gh api -X POST .../issues/<n>/labels -f "labels[]=..."`,
  `gh api -X PATCH .../issues/<n> -f state=closed`.
- **PRs**: `gh api -X POST .../pulls -f title=... -f head=... -f base=main -f body=...`,
  `gh api .../pulls/<n>/files`, `gh api -X PUT .../pulls/<n>/merge -f merge_method=squash`.
- **A failed CI job**: the job's log is out of reach (its download host is outside the
  session's network policy), so read its annotations,
  `gh api .../check-runs/<job id>/annotations` (the job ids are in
  `.../actions/runs/<run id>/jobs`), and reproduce the failing step locally.
- **Review threads, ready for review, auto-merge**: the session's own routes on the REST
  API, `.../pulls/<n>/ccr/review_threads`, `.../pulls/<n>/ccr/ready_for_review` and
  `.../pulls/<n>/ccr/auto_merge`, as the GraphQL error message lists.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.
The remote is `will-ness-ai/ballest`. Issues and pull requests share one number space here,
and most history so far is PRs (`#42`, `#43`, `#44`), so a bare `#n` in a commit message is
usually a PR: try `gh pr view <n>` before `gh issue view <n>`.

Work is merged from `claude/<slug>` branches, squash-merged onto `main`; see the Git section
of `CODING_STANDARDS.md`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
