// `pnpm --silent pr`: a pull request's CI, for agents; follows the agent-tools skill. `why <n>`
// answers why a PR's head is red in one call, from the REST API alone (GraphQL and the job
// log download are blocked in cloud sessions): each red check, its failed steps, and its
// failure and notice annotations (qa's report is one), formatted by pr/why.mjs. `wait` holds
// until a PR's head CI and preview finish; `land` brings main in, waits, marks ready and
// squash-merges, deciding each move by pr/land.mjs. The review gate reads `pr land <n>` as a
// merge (.claude/hooks/review-gate-rules.mjs).
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { originSlug } from "./github.mjs";
import { ciState, landStep } from "./pr/land.mjs";
import { notGreen, whyReport } from "./pr/why.mjs";

const HELP = {
  "": `usage: pnpm --silent pr [command] [flags]
  (none)  this branch's PR
  why     why a PR's head is red: each failed check's steps and annotations
  wait    until a PR's head CI and preview finish: green, red or still running
  land    bring main in, wait for CI, mark ready, squash-merge
run \`pnpm --silent pr <command> --help\` for a command's flags`,
  why: `usage: pnpm --silent pr why <n> [--full]
  prints the PR's head SHA, then each finished check run on it that didn't pass (any
  conclusion but success or skipped) with its failed steps and its failure and notice
  annotations; "all green" or "still running: ..." otherwise
  --full  annotations uncut (default: each cut at 1500 characters)
examples:
  pnpm --silent pr why 346
  pnpm --silent pr why 346 --full`,
  wait: `usage: pnpm --silent pr wait [<n>] [--timeout <seconds>]
  waits until the PR's head has every check finished and its Vercel preview deployed, then
  prints green (with the preview's URL), the checks that went red, or what is still running
  <n>        the PR (default: this branch's)
  --timeout  seconds to wait (default 540, under a 10-minute tool call)
examples:
  pnpm --silent pr wait
  pnpm --silent pr wait 287 --timeout 300`,
  land: `usage: pnpm --silent pr land <n> [--timeout <seconds>]
  lands a PR in the order the repo asks: brings main in when the head is behind (GitHub's
  update-branch, a merge commit on the PR), waits for CI on that head, marks a draft ready,
  then squash-merges it. Stops on red CI or a conflict; a merged PR is a no-op. The review
  gate checks it like any merge.
  --timeout  seconds to wait for CI in all (default 540)
examples:
  pnpm --silent pr land 287
  pnpm --silent pr land 287 --timeout 300`,
};
const FLAGS = { "": [], why: ["--full"], wait: ["--timeout"], land: ["--timeout"] };
/* seconds between looks at CI, and how long a green head must stay green before it counts
   (a workflow can register its checks after another's have all finished) */
const POLL = 15;

const run = promisify(execFile);
const say = (text) => console.log(text);
const note = (text) => console.error(text);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

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

/* gh api's JSON for a write to a REST path, with `fields` as -f key=value */
async function write(method, path, fields = {}) {
  const f = Object.entries(fields).flatMap(([k, v]) => ["-f", `${k}=${v}`]);
  try {
    const { stdout } = await run("gh", ["api", "-X", method, path, ...f]);
    return stdout.trim() ? JSON.parse(stdout) : {};
  } catch (e) {
    throw new Fail(`gh api -X ${method} ${path}: ${firstLine(e)}`);
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
  const pr = await pull(slug, n);
  const runs = await checks(pr.head.sha, slug);
  say(whyReport(pr.head.sha, runs, { full: args.includes("--full") }));
}

/* the PR, or a Fail naming the command that lists this branch's */
const pull = (slug, n) =>
  api(`repos/${slug}/pulls/${n}`).catch((e) => {
    throw e instanceof Fail && e.message.startsWith("not found")
      ? new Fail(`no PR #${n} in ${slug}`, "pnpm --silent pr   # this branch's PR")
      : e;
  });

/* `sha`'s Vercel preview ({ state, url }) from Vercel's commit status, which a build that
   vercel.json's ignoreCommand skips gets too (success, "Canceled by Ignored Build Step"), or
   null before Vercel has posted one; the URL is the deployment's once it has one */
async function preview(slug, sha) {
  const statuses = await api(`repos/${slug}/commits/${sha}/statuses?per_page=100`);
  const status = statuses.find((x) => x.context === "Vercel");
  if (!status) return null;
  if (/Ignored Build Step/i.test(status.description ?? ""))
    return { state: status.state, url: "(skipped: no site file changed)" };
  if (status.state !== "success") return { state: status.state, url: status.target_url };
  const [dep] = await api(`repos/${slug}/deployments?sha=${sha}&per_page=1`);
  const [done] = dep
    ? await api(`repos/${slug}/deployments/${String(dep.id)}/statuses?per_page=1`)
    : [];
  return { state: "success", url: done?.environment_url || status.target_url };
}

/* `sha`'s CI by ciState, with its preview; a green head is asked twice, POLL apart, and counts
   only when nothing new started in between */
async function headCi(slug, sha) {
  const look = async () => {
    const [pages, pre] = await Promise.all([
      api(`repos/${slug}/commits/${sha}/check-runs?per_page=100`, { all: true }),
      preview(slug, sha),
    ]);
    return {
      ci: ciState(
        pages.flatMap((p) => p.check_runs),
        pre ?? undefined,
      ),
      preview: pre,
    };
  };
  const first = await look();
  if (first.ci.state !== "green") return first;
  await sleep(POLL);
  const again = await look();
  return again.ci.state === "green" && again.ci.checks !== first.ci.checks
    ? { ...again, ci: { state: "running", names: ["checks that just started"] } }
    : again;
}

const ciLine = (ci) =>
  ci.state === "green"
    ? `ci: green, ${String(ci.checks)} checks`
    : ci.state === "none"
      ? "ci: no checks yet"
      : `ci: ${ci.state}: ${ci.names.join(", ")}`;
const previewLine = (p) =>
  `preview: ${p ? `${p.state} ${p.url ?? ""}`.trim() : "none for this head"}`;

/* the command's PR number and --timeout, or a usage error */
function parse(command, args) {
  const pos = [];
  let timeout = 540;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--timeout") {
      timeout = Number(args[++i]);
      if (!(timeout > 0)) usage(command, "--timeout needs a number of seconds");
    } else if (!args[i].startsWith("--")) pos.push(args[i]);
  }
  const n = pos.at(0)?.replace(/^#/, "");
  if (n !== undefined && !/^\d+$/.test(n)) usage(command, `${n} is not a PR number`);
  return { n, timeout };
}

function usage(command, message) {
  say(`error: ${message}\n${HELP[command]}`);
  process.exit(2);
}

/* this checkout's branch and the PR open from it, if any */
async function branchPr(slug) {
  const branch = await currentBranch();
  const [pr] = branch
    ? await api(`repos/${slug}/pulls?head=${slug.split("/")[0]}:${branch}&state=open`)
    : [];
  return { branch, pr };
}
const noneFrom = (branch) => `none open from ${branch || "a detached HEAD"}`;

async function wait(args) {
  const { n: given, timeout } = parse("wait", args);
  const slug = repo();
  let n = given;
  if (n === undefined) {
    const { branch, pr } = await branchPr(slug);
    if (!pr) throw new Fail(`no PR ${noneFrom(branch)}`, "pnpm --silent pr wait <n>");
    n = String(pr.number);
  }
  const deadline = Date.now() + timeout * 1000;
  for (;;) {
    const pr = await pull(slug, n);
    const { ci, preview: pre } = await headCi(slug, pr.head.sha);
    const done = ci.state === "green" || ci.state === "red";
    if (done || Date.now() >= deadline) {
      say(`head: ${pr.head.sha.slice(0, 7)} (#${n})`);
      say(done ? ciLine(ci) : `${ciLine(ci)} (still, after ${String(timeout)}s)`);
      say(previewLine(pre));
      say(
        ci.state === "green"
          ? `help[1]:\n  pnpm --silent pr land ${n}`
          : ci.state === "red"
            ? `help[1]:\n  pnpm --silent pr why ${n}`
            : `help[1]:\n  pnpm --silent pr wait ${n} --timeout ${String(timeout)}`,
      );
      if (ci.state !== "green") process.exit(1);
      return;
    }
    note(ciLine(ci));
    await sleep(POLL);
  }
}

/* marks `n` ready: gh's GraphQL where it works, else the cloud proxy's REST route; when
   neither does, the Fail carries both errors */
async function markReady(slug, n) {
  try {
    await run("gh", ["pr", "ready", n, "-R", slug]);
  } catch (e) {
    await write("POST", `repos/${slug}/pulls/${n}/ccr/ready_for_review`).catch((f) => {
      throw new Fail(`can't mark #${n} ready: gh pr ready: ${firstLine(e)}; ${f.message}`);
    });
  }
}

async function land(args) {
  const { n, timeout } = parse("land", args);
  if (n === undefined) usage("land", "land needs a PR number");
  const slug = repo();
  const deadline = Date.now() + timeout * 1000;
  const did = [];
  const asked = {};
  /* what landing did and why it stopped, then the commands that come next; exits 1 */
  const stop = (sha, lines, next) => {
    say(
      [
        `head: ${sha.slice(0, 7)} (#${n})`,
        ...(did.length ? [`did: ${did.join(", ")}`] : []),
        ...lines,
        ...help(next),
      ].join("\n"),
    );
    process.exit(1);
  };
  for (;;) {
    const pr = await pull(slug, n);
    const { sha, ref } = pr.head;
    const base = pr.base.ref;
    const resolve = [
      `git fetch origin ${base} && git merge origin/${base}   # on ${ref}; resolve, push`,
      `pnpm --silent pr land ${n}`,
    ];
    const [{ behind_by: behind }, { ci, preview: pre }] = pr.merged
      ? [{ behind_by: 0 }, { ci: { state: "green" } }]
      : await Promise.all([api(`repos/${slug}/compare/${base}...${sha}`), headCi(slug, sha)]);
    const next = landStep(pr, behind, ci, asked);
    if (next.do === "done") {
      say(`pr: #${n} merged${did.length ? "" : " (no-op)"}`);
      return;
    }
    if (next.do === "stop")
      stop(
        sha,
        [`error: ${next.why}`],
        {
          conflict: resolve,
          red: [`pnpm --silent pr why ${n}`],
          closed: ["pnpm --silent pr   # this branch's PR"],
        }[next.on],
      );
    if (next.do !== "merge" && Date.now() >= deadline)
      stop(
        sha,
        [`${ciLine(ci)} (still, after ${String(timeout)}s)`, previewLine(pre)],
        [`pnpm --silent pr land ${n}`],
      );
    if (next.do === "wait") {
      note(ciLine(ci));
      await sleep(POLL);
    } else if (next.do === "update") {
      note(`bringing ${base} in (${String(behind)} behind)`);
      await write("PUT", `repos/${slug}/pulls/${n}/update-branch`, {
        expected_head_sha: sha,
      }).catch((e) =>
        stop(sha, [`error: GitHub couldn't bring ${base} in: ${e.message}`], resolve),
      );
      asked.updated = sha;
      did.push(`merged ${base} in`);
      await sleep(POLL);
    } else if (next.do === "ready") {
      await markReady(slug, n);
      asked.readied = true;
      did.push("marked ready");
    } else {
      const merged = await write("PUT", `repos/${slug}/pulls/${n}/merge`, {
        merge_method: "squash",
        sha,
      }).catch((e) =>
        stop(
          sha,
          [`error: GitHub refused the merge: ${e.message}`],
          [`pnpm --silent pr wait ${n}`, `pnpm --silent pr land ${n}`],
        ),
      );
      say(
        [
          `pr: #${n} merged as ${String(merged.sha).slice(0, 7)}`,
          `did: ${[...did, "squash-merged"].join(", ")}`,
          previewLine(pre),
          ...help([
            `git fetch origin ${base} && git checkout -B ${ref} origin/${base}   # follow-up work starts from ${base}`,
          ]),
        ].join("\n"),
      );
      return;
    }
  }
}

const help = (cmds) => [`help[${String(cmds.length)}]:`, ...cmds.map((c) => `  ${c}`)];

async function currentBranch() {
  return run("git", ["branch", "--show-current"]).then(
    (r) => r.stdout.trim(),
    (e) => {
      throw new Fail(`git can't name this checkout's branch: ${firstLine(e)}`, "git status");
    },
  );
}

async function home() {
  const slug = repo();
  const { branch, pr } = await branchPr(slug);
  say(
    pr
      ? `pr: #${String(pr.number)} ${pr.draft ? "draft" : "open"} (${branch})`
      : `pr: ${noneFrom(branch)}`,
  );
  say(HELP[""]);
  if (pr) {
    const n = String(pr.number);
    say(
      help([
        `pnpm --silent pr wait ${n}`,
        `pnpm --silent pr why ${n}`,
        `pnpm --silent pr land ${n}`,
      ]).join("\n"),
    );
  }
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
    await ({ why, wait, land }[command] ?? home)(args);
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    say(`error: ${e.message}\nhelp[1]:\n  ${e.next}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
