// `pnpm --silent pr`: a pull request's CI, for agents; follows the agent-tools skill. `why <n>`
// answers why a PR's head is red in one call, from the REST API alone (GraphQL and the job
// log download are blocked in cloud sessions): each red check, its failed steps, and its
// failure and notice annotations (qa's report is one), formatted by pr/why.mjs.
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { originSlug } from "./github.mjs";
import { notGreen, whyReport } from "./pr/why.mjs";

const HELP = {
  "": `usage: pnpm --silent pr [command] [flags]
  (none)  this branch's PR
  why     why a PR's head is red: each failed check's steps and annotations
run \`pnpm --silent pr <command> --help\` for a command's flags`,
  why: `usage: pnpm --silent pr why <n> [--full]
  prints the PR's head SHA, then each finished check run on it that didn't pass (any
  conclusion but success or skipped) with its failed steps and its failure and notice
  annotations; "all green" or "still running: ..." otherwise
  --full  annotations uncut (default: each cut at 1500 characters)
examples:
  pnpm --silent pr why 346
  pnpm --silent pr why 346 --full`,
};
const FLAGS = { "": [], why: ["--full"] };

const run = promisify(execFile);
const say = (text) => console.log(text);

/* a failure in the tool's own terms, with the command that comes next */
class Fail extends Error {
  constructor(message, next = "gh api user   # is gh signed in and GitHub reachable") {
    super(message);
    this.next = next;
  }
}

const firstLine = (e) =>
  String(e.stderr || e.message)
    .trim()
    .split("\n")[0];

/* gh api's JSON for a REST path (every page of it, as an array of pages, with `all`), or a
   Fail in the tool's terms */
async function api(path, { all = false } = {}) {
  const args = all ? ["api", "--paginate", "--slurp", path] : ["api", path];
  try {
    const { stdout } = await run("gh", args, { maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (e) {
    const why = firstLine(e);
    throw new Fail(/HTTP 404/.test(why) ? `not found: ${path}` : `gh api ${path}: ${why}`);
  }
}

/* this checkout's "owner/name", from origin */
function repo() {
  try {
    return originSlug(process.cwd());
  } catch (e) {
    throw new Fail(
      `can't read this checkout's origin: ${firstLine(e)}`,
      "git remote -v   # run pr from a checkout of the repo",
    );
  }
}

/* the check runs on `sha` in `slug`, each with its Actions job's steps and its annotations */
export async function checks(sha, slug = repo()) {
  const pages = await api(`repos/${slug}/commits/${sha}/check-runs?per_page=100`, { all: true });
  const runs = pages.flatMap((p) => p.check_runs);
  return Promise.all(
    runs.map(async (r) => {
      const actions = r.app?.slug === "github-actions";
      const [job, annotations] = notGreen(r)
        ? await Promise.all([
            actions ? api(`repos/${slug}/actions/jobs/${String(r.id)}`) : null,
            r.output?.annotations_count
              ? api(`repos/${slug}/check-runs/${String(r.id)}/annotations?per_page=100`, {
                  all: true,
                }).then((p) => p.flat())
              : [],
          ])
        : [null, []];
      return {
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        detailsUrl: r.details_url,
        steps: job?.steps,
        annotations,
      };
    }),
  );
}

async function why(args) {
  const n = args.find((a) => !a.startsWith("--"));
  if (!n || !/^\d+$/.test(n)) {
    say(`error: why needs a PR number\n${HELP.why}`);
    process.exit(2);
  }
  const slug = repo();
  const pr = await api(`repos/${slug}/pulls/${n}`).catch((e) => {
    throw e instanceof Fail && e.message.startsWith("not found")
      ? new Fail(`no PR #${n} in ${slug}`, "pnpm --silent pr   # this branch's PR")
      : e;
  });
  const runs = await checks(pr.head.sha, slug);
  say(whyReport(pr.head.sha, runs, { full: args.includes("--full") }));
}

async function home() {
  const slug = repo();
  const branch = await run("git", ["branch", "--show-current"]).then(
    (r) => r.stdout.trim(),
    (e) => {
      throw new Fail(`git can't name this checkout's branch: ${firstLine(e)}`, "git status");
    },
  );
  const prs = branch
    ? await api(`repos/${slug}/pulls?head=${slug.split("/")[0]}:${branch}&state=open`)
    : [];
  say(
    prs.length
      ? `pr: #${String(prs[0].number)} ${prs[0].draft ? "draft" : "open"} (${branch})`
      : `pr: none open from ${branch || "a detached HEAD"}`,
  );
  say(HELP[""]);
  if (prs.length) say(`help[1]:\n  pnpm --silent pr why ${String(prs[0].number)}`);
}

async function main([cmd = "", ...args]) {
  const command = cmd.startsWith("--") ? "" : cmd;
  const flags = (command ? args : [cmd, ...args]).filter((a) => a.startsWith("--"));
  if (!Object.hasOwn(HELP, command)) {
    say(`error: unknown command ${command}\n${HELP[""]}`);
    process.exit(2);
  }
  if (flags.includes("--help")) {
    say(HELP[command]);
    process.exit(0);
  }
  const unknown = flags.find((f) => !FLAGS[command].includes(f));
  if (unknown) {
    say(`error: unknown flag ${unknown}\n${HELP[command]}`);
    process.exit(2);
  }
  try {
    await (command === "why" ? why(args) : home());
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    say(`error: ${e.message}\nhelp[1]:\n  ${e.next}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
