// /daily, or /daily/<YYYY-MM-DD>: the Daily page (components/daily/DailyView), on the
// newest Daily or on that day. proxy.ts has already 404'd any other path; a real day with no
// Daily goes to /daily. The newest few days are prerendered, so the route has a static
// shell; any other is served from it, then cached whole.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { DailySkeleton } from "../../../components/Skeleton";
import { DailyView } from "../../../components/daily/DailyView";
import { getDaily, getDailyDates } from "../../../db/data";
import { dayLabel } from "../../../lib/daily";
import { isDailyDate } from "../../../lib/routes";

interface Props {
  params: Promise<{ slot?: Array<string> }>;
}

export async function generateStaticParams() {
  const dates = await getDailyDates();
  return [{ slot: [] }, ...dates.slice(-3).map((date) => ({ slot: [date] }))];
}

const dateOf = (slot: Array<string> = []) => (isDailyDate(slot[0]) ? slot[0] : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const date = dateOf((await params).slot);
  const d = date ? await getDaily(date) : null;
  if (!d)
    return {
      title: "Daily",
      description: "The game's Daily, one Workshop map a day, and every day's results.",
    };
  return {
    title: `${d.title} · Daily ${dayLabel(d.date, true)}`,
    description: `The Daily of ${dayLabel(d.date, true)} on ${d.title}: every time, read straight from Steam.`,
  };
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
