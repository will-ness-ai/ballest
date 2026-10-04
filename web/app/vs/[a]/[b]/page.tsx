// /vs/<a>/<b>: the head to head between two players (components/player/VsView). The top
// two of Season 2's Overall board are prerendered; any other pair is served from the App
// Shell, then cached whole. A player against themselves is just their page.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Shell } from "../../../../components/Shell";
import { VsView } from "../../../../components/player/VsView";
import { PageFallback } from "../../../../components/player/pieces";
import { getBoardPage, getPlayer } from "../../../../db/data";
import { S2_OVERALL_BOARD } from "../../../../lib/circuit";
import { playerHref } from "../../../../lib/routes";
import { isSteamId, personaOf } from "../../../../lib/rules";

/* spelled out rather than Next's generated PageProps, which only exists after a build */
interface Props {
  params: Promise<{ a: string; b: string }>;
}

export async function generateStaticParams() {
  const top = await getBoardPage(S2_OVERALL_BOARD, 0, 2);
  const [a, b] = top.rows.map((r) => r.steamId);
  return [{ a, b }];
}

async function pairOf({ a, b }: Awaited<Props["params"]>) {
  if (!isSteamId(a) || !isSteamId(b) || a === b) return null;
  const [A, B] = await Promise.all([getPlayer(a), getPlayer(b)]);
  return A && B ? { A, B } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const pair = await pairOf(await params);
  if (!pair) return {};
  const title = personaOf(pair.A.who) + " vs " + personaOf(pair.B.who);
  return {
    title,
    description: `${title}: every Circuit track and Workshop map they both have a time on, in Ballest of Them All.`,
  };
}

async function Vs({ params }: Pick<Props, "params">) {
  const p = await params;
  if (p.a === p.b && isSteamId(p.a)) redirect(playerHref(p.a));
  const pair = await pairOf(p);
  if (!pair) notFound();
  return <VsView key={p.a + "/" + p.b} A={pair.A} B={pair.B} />;
}

export default function Page({ params }: Props) {
  return (
    <Shell view="vs">
      <Suspense fallback={<PageFallback id="vs" className="pp vsp" />}>
        <Vs params={params} />
      </Suspense>
    </Shell>
  );
}
