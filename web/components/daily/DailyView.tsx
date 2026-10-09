// The Daily page on one day (/daily/<date>), or on the newest Daily (/daily): the Days |
// Standings switch, every day to pick from (DayPicker: the calendar beside the panel on a
// desktop, the day strip over it on a phone), and the day's panel (DayPanel) over its
// whole board. A Daily's board is small (a few hundred times at most so far), so it is
// read whole and "Show all" needs no further read.
import { redirect } from "next/navigation";

import { DocTitle } from "../Behaviours";
import { DailySwitch } from "./DailySwitch";
import { DayPanel } from "./DayPanel";
import { DayPicker } from "./DayPicker";
import { getDailies, getDaily, readBoard } from "../../db/data";
import { dayLabel } from "../../lib/daily";
import { dailyHref } from "../../lib/routes";

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
      <div className="main">
        <DailySwitch on="days" />
        <section className="content daily">
          <p className="dp-none">No Daily has been read yet.</p>
        </section>
      </div>
    );
  }
  const board = await readBoard(d.board, 0, MAX_ROWS);
  return (
    <div className="main">
      <DocTitle title={`${d.title} · Daily ${dayLabel(d.date, true)}`} />
      <DailySwitch on="days" />
      <DayPicker days={days} picked={d.date} />
      <section className="content daily">
        <DayPanel key={d.date} d={d} rows={board.rows} />
      </section>
    </div>
  );
}
