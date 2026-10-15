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
import { Picker } from "../../../../components/campaign/Picker";
import {
  getBoardPage,
  getDailies,
  getPlayer,
  getPlayerCampaigns,
  getPlayerDailies,
} from "../../../../db/data";
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
  const camps = await getPlayerCampaigns(rec.id, rec.workshop.finishes);
  return (
    <>
      <DocTitle title={personaOf(rec.who)} />
      <PlayerView
        rec={rec}
        tab={p.tab?.[0] === "campaigns" ? "campaigns" : tabFor(rec, p.tab?.[0] ?? null)}
        daily={{ mine, days }}
        camps={camps}
      />
      <Picker
        variants={[
          { key: "A", name: "Seasons on Workshop", note: "On the Workshop tab, each Campaign drawn like a Circuit season: place, points and a tile per Map." },
          { key: "B", name: "Campaigns tab", note: "Its own tab beside Circuit and Workshop, holding the same season blocks." },
          { key: "C", name: "Cards", note: "A row of small cards on the Workshop tab: place of N, points, maps finished and a bar." },
          { key: "D", name: "Header line", note: "Nothing on a tab: one line under their name, 4th in Solar Trials and so on." },
          { key: "E", name: "Table", note: "A row per Campaign on the Workshop tab with their place on each Map, medal colours for a podium." },
        ]}
        states={[
          ["Leth", "/player/76561198085868465/workshop"],
          ["Leth (Campaigns tab)", "/player/76561198085868465/campaigns?variant=B"],
        ]}
      />
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
