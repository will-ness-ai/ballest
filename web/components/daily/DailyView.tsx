// The Daily page on one day (/daily/<date>), or on the newest Daily (/daily): the page head
// naming the day's Map, every day to pick from (DayPicker: the calendar beside the panel on
// a desktop, the day strip over it on a phone), and the day's panel (DayPanel) over its
// whole board. A Daily's board is small (a few hundred times at most so far), so it is
// read whole and "Show all" needs no further read. Today and Standings are the header's
// sub-tabs.
import { redirect } from "next/navigation";

import { DocTitle } from "../Behaviours";
import { PageHead } from "../PageHead";
import { Remember } from "../Trail";
import { DayPanel } from "./DayPanel";
import { DayPicker } from "./DayPicker";
import { getDailies, getDaily, readBoard } from "../../db/data";
import { dayLabel } from "../../lib/daily";
import { dailyHref, mapHref } from "../../lib/routes";

/* the most rows a Daily's board is read to */
const MAX_ROWS = 20_000;

/* `date` null opens the newest Daily; a day with none goes to the newest */
export async function DailyView({ date }: { date: string | null }) {
  const days = await getDailies();
  const day = date ?? days.at(-1)?.date;
  const d = day ? await getDaily(day) : null;
  if (!d) {
    if (date) redirect(dailyHref());
    return (
      <>
        <PageHead path={dailyHref()} title="Daily" />
        <div className="main">
          <section className="content daily">
            <p className="dp-none">No Daily has been read yet.</p>
          </section>
        </div>
      </>
    );
  }
  const board = await readBoard(d.board, 0, MAX_ROWS);
  const here = dailyHref(date);
  const label = `Daily ${dayLabel(d.date, true)}`;
  return (
    <>
      <PageHead path={here} title={d.title} />
      <div className="main">
        <DocTitle title={`${d.title} · ${label}`} />
        <DayPicker days={days} picked={d.date} />
        <section className="content daily">
          <DayPanel key={d.date} d={d} rows={board.rows} />
        </section>
        <Remember trail="board" href={here} label={label} />
        <Remember trail="maps" href={here} label={label} leads={[mapHref(d.pfid)]} />
      </div>
    </>
  );
}
