// /discord/link?t=<token>: the Stats Link's page (components/discord/LinkView, ADR 0014), where
// a player Multiballs sent here pairs their Discord account with their Steam sign-in. The one
// page that reads the session while it draws, so it is never cached; kept out of search results.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { LinkView } from "../../../components/discord/LinkView";
import { statsLinkDeps } from "../../../db/data";
import { linkPageOf } from "../../../db/stats-link";
import { sessionOfCookie } from "../../../lib/auth";
import { SESSION_COOKIE } from "../../../lib/cookies";

interface Props {
  searchParams: Promise<{ t?: string | Array<string> }>;
}

export const metadata: Metadata = {
  title: "Pair your Discord account",
  robots: { index: false },
};

async function Link({ searchParams }: Props) {
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";
  const steamId = sessionOfCookie((await cookies()).get(SESSION_COOKIE)?.value);
  return <LinkView page={await linkPageOf(statsLinkDeps(), token, steamId)} token={token} />;
}

export default function Page({ searchParams }: Props) {
  return (
    <Shell view="link">
      <Suspense>
        <Link searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}
