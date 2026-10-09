// /player/<steam_id>[/circuit|workshop|made|daily]: a player's page (components/player). With no
// tab in the path it opens on the player's home tab. The leaders of Season 2's Overall
// board are prerendered; anyone else is served from the App Shell, then cached whole.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DocTitle } from "../../../../components/Behaviours";
import { Shell } from "../../../../components/Shell";
import { PlayerSkeleton } from "../../../../components/Skeleton";
import { PlayerView, tabFor } from "../../../../components/player/PlayerView";
import { getBoardPage, getDailies, getPlayer, getPlayerDailies } from "../../../../db/data";
import { S2_OVERALL_BOARD } from "../../../../lib/circuit";
import { isPlayerTab } from "../../../../lib/routes";
import { isSteamId, personaOf } from "../../../../lib/rules";
import { shareMetadata } from "../../../../components/share/metadata";

interface Props {
  params: Promise<{ id: string; tab?: Array<string> }>;
}

export async function generateStaticParams() {
  const top = await getBoardPage(S2_OVERALL_BOARD, 0, 5);
  return top.rows.map((r) => ({ id: r.steamId, tab: [] }));
}

/* the record a path names, or null for a path that names no page */
async function recordOf({ id, tab = [] }: Awaited<Props["params"]>) {
  if (!isSteamId(id) || tab.length > 1) return null;
  if (tab.length && !isPlayerTab(tab[0])) return null;
  return getPlayer(id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const rec = await recordOf(await params);
  if (!rec) return {};
  const name = personaOf(rec.who);
  return shareMetadata(
    {
      title: name,
      description: `${name}'s Circuit, Workshop and Daily times on Ballest of Them All, read straight from Steam.`,
    },
    { kind: "player", id: rec.id, alt: `${name}'s marble and record on Ballest of Them All.` },
  );
}

async function Player({ params }: Pick<Props, "params">) {
  const p = await params;
  const [rec, mine, days] = await Promise.all([recordOf(p), getPlayerDailies(p.id), getDailies()]);
  if (!rec || !mine) notFound();
  return (
    <>
      <DocTitle title={personaOf(rec.who)} />
      <PlayerView rec={rec} tab={tabFor(rec, p.tab?.[0] ?? null)} daily={{ mine, days }} />
    </>
  );
}

export default function Page({ params }: Props) {
  return (
    <Shell view="player">
      <Suspense fallback={<PlayerSkeleton id="player" className="pp" />}>
        <Player params={params} />
      </Suspense>
    </Shell>
  );
}
