"use client";
// A player's page leads back to the board the reader came from, or with none to every
// leaderboard (board/RememberBoard.tsx keeps it for the tab's session).
import Link from "next/link";

import { useRememberedBoard } from "../board/RememberBoard";

export function BackLink() {
  const b = useRememberedBoard();
  return (
    <Link className="back" href={b.href}>
      &larr; {b.label}
    </Link>
  );
}
