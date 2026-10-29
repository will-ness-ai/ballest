// PROTOTYPE: /trials, the Official Section's Trials sub-tab (claude/prototype-official).
import type { Metadata } from "next";

import { PageHead } from "../../components/PageHead";
import { Shell } from "../../components/Shell";
import { TrialsProto } from "../../components/prototype/TrialsProto";

export const metadata: Metadata = { title: "Trials" };

export default function Page() {
  return (
    <Shell view="board">
      <PageHead path="/trials" title="Trials" />
      <section className="ws tp">
        <p className="tp-intro">
          The game&apos;s own boards outside the Circuit: The Tower, with and without checkpoints,
          and one-off events.
        </p>
        <TrialsProto />
      </section>
    </Shell>
  );
}
