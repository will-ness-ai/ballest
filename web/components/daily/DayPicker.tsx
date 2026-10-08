"use client";
// The Daily page's days, each a link to its /daily/<date>: on a desktop the calendar of every
// month beside the day's panel; on a phone a sideways strip of days over the panel, newest at
// the right, with a Calendar button that opens the same months over the page. A day shows
// its Map's picture, its number and its 1st's marble; today's is brighter, the picked day is
// outlined, and a day with no Daily is left empty. Which day is today is the reader's clock
// against the newest Daily's close (todayOf), so a cached page dims it at the close. A
// player's Daily tab draws the same months (Months) with their place on each day.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { MapImage } from "../MapImage";
import { Marble } from "../Marble";
import { useDialog } from "../Modal";
import { useMounted, useNowPast } from "../../hooks/client";
import { bandOf, calendarOf, dayLabel, todayOf } from "../../lib/daily";
import { dailyHref } from "../../lib/routes";
import type { DailyCell, PlayerDaily } from "../../lib/rows";
import { fmtN, ord } from "../../lib/rules";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];

const monthShort = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

/* A day. On a player's Daily tab (`mine` given) it is bordered in the band of their place,
   which it shows in place of the 1st's marble, or in the played band while the Daily is not
   final, since a place on it is not a win or a podium yet; a day they missed (`mine` null)
   is dimmed. */
function Day({
  d,
  picked,
  today,
  month,
  onPick,
  mine,
}: {
  d: DailyCell;
  picked: boolean;
  today: boolean;
  /* the strip names each day's month too; the calendar's heading does that */
  month?: boolean;
  onPick?: () => void;
  mine?: PlayerDaily | null;
}) {
  const what =
    `${dayLabel(d.date, true)}: ${d.title}` +
    (mine === undefined
      ? d.winner
        ? `, 1st ${d.winner.persona}`
        : ""
      : mine
        ? `, ${ord(mine.rank)} of ${fmtN(mine.field)}`
        : ", not played");
  return (
    <Link
      className="dc-day"
      href={dailyHref(d.date)}
      aria-current={picked ? "page" : undefined}
      data-today={today || undefined}
      data-b={mine === undefined ? undefined : mine ? bandOf(mine) : "miss"}
      aria-label={what}
      title={what}
      onClick={onPick}
    >
      <MapImage preview={d.preview} />
      <span className="dc-n">{Number(d.date.slice(8))}</span>
      {month && <span className="dc-mo">{monthShort(d.date)}</span>}
      {mine === undefined ? (
        /* only the marble's colour: the day itself is the link, so no avatar button inside it */
        d.winner && <Marble who={{ steamId: d.winner.steamId }} />
      ) : mine ? (
        <span className="dc-place">
          {mine.rank}
          <small>{ord(mine.rank).slice(-2)}</small>
        </span>
      ) : null}
    </Link>
  );
}

/* The months of every Daily, newest first. With `mine` (a player's Dailies by date), the
   days are that player's, as their Daily tab draws them. */
export function Months({
  days,
  picked = "",
  today = null,
  onPick,
  mine,
}: {
  days: ReadonlyArray<DailyCell>;
  picked?: string;
  today?: string | null;
  onPick?: () => void;
  mine?: Readonly<Record<string, PlayerDaily | undefined>>;
}) {
  return calendarOf(days).map((m) => (
    <section key={m.month} className="dc-month" aria-label={m.name}>
      <h2>{m.name}</h2>
      <div className="dc-grid">
        {WEEK.map((w, i) => (
          <span key={i} className="dc-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {m.lead > 0 && <span style={{ gridColumn: `span ${String(m.lead)}` }}></span>}
        {m.days.map((x) =>
          x.daily ? (
            <Day
              key={x.date}
              d={x.daily}
              picked={x.date === picked}
              today={x.date === today}
              onPick={onPick}
              mine={mine && (mine[x.date] ?? null)}
            />
          ) : (
            <span key={x.date} className="dc-day" data-none="">
              <span className="dc-n">{x.n}</span>
            </span>
          ),
        )}
      </div>
    </section>
  ));
}

/* the sheet opens focused on the picked day, scrolled to it */
const onThePickedDay = (d: HTMLDialogElement) => {
  const at = d.querySelector<HTMLElement>('[aria-current="page"]');
  at?.scrollIntoView({ block: "center" });
  return at;
};

export function DayPicker({ days, picked }: { days: ReadonlyArray<DailyCell>; picked: string }) {
  const today = todayOf(days, useNowPast(days.at(-1)?.endsAt ?? ""));
  const mounted = useMounted();
  const head = useId();
  const strip = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { props, close } = useDialog({
    open,
    onClose: () => {
      setOpen(false);
    },
    focus: onThePickedDay,
    from: trigger,
  });
  /* a desktop has the calendar beside the panel instead (desktop.css's 820px), so the
     sheet closes rather than stay modal and hidden when the window widens */
  useEffect(() => {
    const wide = matchMedia("(min-width: 820px)");
    const shut = () => {
      if (wide.matches) close();
    };
    wide.addEventListener("change", shut);
    return () => {
      wide.removeEventListener("change", shut);
    };
  }, [close]);

  /* the strip opens on the picked day (today's, on /daily), at the right if it is the newest */
  useEffect(() => {
    const el = strip.current,
      at = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && at) el.scrollLeft = at.offsetLeft - (el.clientWidth - at.offsetWidth) / 2;
  }, [picked]);

  return (
    <>
      <div className="dc-strip">
        <div className="dc-days" ref={strip}>
          {days.map((d) => (
            <Day key={d.date} d={d} picked={d.date === picked} today={d.date === today} month />
          ))}
        </div>
        <button
          type="button"
          className="dc-open"
          ref={trigger}
          aria-haspopup="dialog"
          onClick={() => {
            setOpen(true);
          }}
        >
          Calendar
        </button>
      </div>
      <aside className="dc-side" aria-label="Every Daily">
        <Months days={days} picked={picked} today={today} />
      </aside>
      {mounted &&
        createPortal(
          <dialog className="dc-sheet" aria-labelledby={head} {...props}>
            <div className="dh">
              <h2 id={head}>Every Daily</h2>
              <button type="button" aria-label="Close" onClick={close}>
                &times;
              </button>
            </div>
            <Months days={days} picked={picked} today={today} onPick={close} />
          </dialog>,
          document.body,
        )}
    </>
  );
}
