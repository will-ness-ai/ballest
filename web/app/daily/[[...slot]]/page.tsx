// /daily, or /daily/<YYYY-MM-DD>: the Daily page (components/daily/DailyView), on the
// newest Daily or on that day. proxy.ts has already 404'd any other path; a real day with no
// Daily goes to /daily. The newest few days are prerendered, so the route has a static
// shell; any other is served from it, then cached whole.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { DailySkeleton } from "../../../components/Skeleton";
import { DailyView } from "../../../components/daily/DailyView";
import { getDailies, getDaily, getDailyDates } from "../../../db/data";
import { dayLabel } from "../../../lib/daily";
import { isDailyDate } from "../../../lib/routes";
import { shareMetadata } from "../../../components/share/metadata";

interface Props {
  params: Promise<{ slot?: Array<string> }>;
}

export async function generateStaticParams() {
  const dates = await getDailyDates();
  return [{ slot: [] }, ...dates.slice(-3).map((date) => ({ slot: [date] }))];
}

const dateOf = (slot: Array<string> = []) => (isDailyDate(slot[0]) ? slot[0] : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slot = [] } = await params;
  const date = dateOf(slot);
  const d = date ? await getDaily(date) : null;
  if (!d) {
    const newest = slot.length ? undefined : (await getDailies()).at(-1)?.date;
    const latest = {
      title: "Daily",
      description: "The game's Daily, one Workshop map a day, and every day's results.",
    };
    /* /daily opens on the newest Daily (DailyView reads the same list), so it shares that
       day's card */
    return newest
      ? shareMetadata(latest, {
          kind: "daily",
          id: newest,
          alt: "The newest Daily's Map and its fastest time.",
        })
      : latest;
  }
  const day = dayLabel(d.date, true);
  return shareMetadata(
    {
      title: `${d.title} · Daily ${day}`,
      description: `The Daily of ${day} on ${d.title}: every time, read straight from Steam.`,
    },
    { kind: "daily", id: d.date, alt: `The Daily of ${day} on ${d.title} and its fastest time.` },
  );
}

async function DailyPage({ params }: Props) {
  return <DailyView date={dateOf((await params).slot)} />;
}

export default function Page({ params }: Props) {
  return (
    <Shell view="daily">
      <Suspense fallback={<DailySkeleton />}>
        <DailyPage params={params} />
      </Suspense>
    </Shell>
  );
}
