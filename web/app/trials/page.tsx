// /trials: the Official Section's Trials sub-tab, a card per Trial (TrialCards) with its
// record and runs from the database (getTrialTops), each linking its board. Prerendered and
// read fresh after each Refresh, as the boards are.
import type { Metadata } from "next";

import { PageHead } from "../../components/PageHead";
import { Shell } from "../../components/Shell";
import { TrialCards } from "../../components/TrialCards";
import { getTrialTops } from "../../db/data";
import { trialsHref } from "../../lib/routes";

export const metadata: Metadata = {
  title: "Trials",
  description:
    "Ballest of Them All's own one-off challenge boards outside the Circuit: The Tower, with and without checkpoints, and Leth Trial #1.",
  alternates: { canonical: trialsHref() },
};

export default async function Page() {
  const tops = await getTrialTops();
  return (
    <Shell view="maps">
      <PageHead path={trialsHref()} title="Trials" />
      <section className="ws" id="ws">
        <div className="call-h">
          <p>
            The game&apos;s own boards outside the Circuit: The Tower, with and without checkpoints,
            and one-off events. Their records count as world records and podiums, never as points.
          </p>
        </div>
        <TrialCards tops={tops} />
      </section>
    </Shell>
  );
}
