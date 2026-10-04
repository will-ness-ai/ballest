// /board/<name>[/<steam_id>|/podiums]: a Circuit board (components/board/CircuitBoardView).
// Every board, and every Overall board's podium order, is prerendered; a link to a
// player's row is served from the App Shell, then cached whole.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../../components/Shell";
import { BoardSkeleton } from "../../../../components/Skeleton";
import { CircuitBoardView } from "../../../../components/board/CircuitBoardView";
import { CIRCUIT, circuitBoard } from "../../../../lib/circuit";
import { PODIUM_SORT } from "../../../../lib/routes";
import { isPoints } from "../../../../lib/rules";

/* spelled out rather than Next's generated PageProps, which only exists after a build */
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
  const title = `${b.group} ${b.display}`;
  return {
    title,
    description: `The ${title} leaderboard of Ballest of Them All, read straight from Steam.`,
  };
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
