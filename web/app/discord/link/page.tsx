// /discord/link?t=<token>: the Stats Link's page (components/discord/LinkView, ADR 0014), where
// a player Multiballs sent here pairs their Discord account with their Steam sign-in. The one
// page that reads the session while it draws, so its read (getLinkPage) is never cached; kept
// out of search results.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { LinkView } from "../../../components/discord/LinkView";
import { getLinkPage } from "../../../db/data";
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
  // the session's age is read against the clock, which must wait for the request
  await connection();
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";
  const steamId = sessionOfCookie((await cookies()).get(SESSION_COOKIE)?.value);
  return <LinkView page={await getLinkPage(token, steamId)} token={token} />;
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
