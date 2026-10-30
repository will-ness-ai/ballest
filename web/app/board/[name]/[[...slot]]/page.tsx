// /board/<name>[/<steam_id>|/podiums]: a Circuit board (components/board/CircuitBoardView).
// Every board, and every Overall board's podium order, is prerendered; a link to a
// player's row is served from the App Shell, then cached whole.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../../components/Shell";
import { BoardSkeleton } from "../../../../components/Skeleton";
import { CircuitBoardView } from "../../../../components/board/CircuitBoardView";
import { CIRCUIT, TRIALS_GROUP, circuitBoard } from "../../../../lib/circuit";
import { PODIUM_SORT, boardHref } from "../../../../lib/routes";
import { isPoints } from "../../../../lib/rules";
import { pageMetadata } from "../../../../components/metadata";
import { hasTrackCard } from "../../../../lib/share";

interface Props {
  params: Promise<{ name: string; slot?: Array<string> }>;
}

export function generateStaticParams() {
  return CIRCUIT.flatMap((b) => [
    { name: b.name, slot: [] },
    ...(isPoints(b.name) ? [{ name: b.name, slot: [PODIUM_SORT] }] : []),
  ]);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const b = circuitBoard(name);
  if (!b) return {};
  /* a Trial goes by its name alone, a Circuit board by its season and number */
  const trial = b.group === TRIALS_GROUP;
  const title = trial ? b.display : `${b.group} ${b.display}`;
  const description = `The ${title} leaderboard of Ballest of Them All, read straight from Steam.`;
  /* a player's row or the podium order is a view of the board; a Track or a Trial has its
     own share image, and an Overall board keeps the site's */
  return pageMetadata(
    { title, description, canonical: boardHref(b.name) },
    hasTrackCard(b)
      ? {
          kind: "track",
          id: b.name,
          alt: `${trial ? "Trial" : "Circuit track"} ${title} and its record.`,
        }
      : undefined,
  );
}

async function Board({ params }: Pick<Props, "params">) {
  const { name, slot = [] } = await params;
  return <CircuitBoardView name={name} slot={slot.length > 1 ? "-" : (slot[0] ?? null)} />;
}

export default function Page({ params }: Props) {
  return (
    <Shell view="board">
      <Suspense fallback={<BoardSkeleton />}>
        <Board params={params} />
      </Suspense>
    </Shell>
  );
}
