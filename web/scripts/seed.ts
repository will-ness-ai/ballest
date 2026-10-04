// pnpm db:seed <dataset> [--i-know-this-is-not-production]
//
// Empties the database at DATABASE_URL and writes the named dataset (db/seed/datasets/).
// The database must already be migrated (a preview's deploy migrates its branch; locally,
// `pnpm db:migrate`). Refuses production (refusal in db/seed/harness.ts). docs/data.md
// has how to seed a preview branch and how to add a dataset.
import { connect } from "../db/client";
import { datasets } from "../db/seed/datasets";
import { isDataset, refusal, seed } from "../db/seed/harness";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));

function usage() {
  console.error("usage: pnpm db:seed <dataset> [--i-know-this-is-not-production]\n\ndatasets:");
  for (const [key, d] of Object.entries(datasets))
    console.error(`  ${key.padEnd(8)} ${d.description}`);
}

const url = process.env.DATABASE_URL;
if (!name || !isDataset(name)) {
  if (name) console.error(`no dataset named "${name}"\n`);
  usage();
  process.exit(1);
} else if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
} else {
  const refused = refusal(url, process.env, args);
  if (refused) {
    console.error(refused);
    process.exit(1);
  }
  const db = connect(url);
  try {
    await seed(db, name);
    console.log(`seeded ${name} into ${new URL(url).hostname}`);
  } finally {
    await db.$client.end();
  }
}
