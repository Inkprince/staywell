'use client';

import Link from 'next/link';
import type { Route } from 'next';

const STAYS = '/stays' as Route;

/** The window StayWell sells in this build; outside it, dates are out of season. */
const MONTH = { year: 2026, month: 8, label: 'September 2026' };
const FIRST_BOOKABLE = 1;
const LAST_BOOKABLE = 7;

const WEEKDAY_HEADER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAYS_IN_MONTH = 30;
/** 2026-09-01 is a Tuesday; the grid starts on Monday. */
const LEADING_BLANKS = 1;

function inWindow(day: number) {
  return day >= FIRST_BOOKABLE && day <= LAST_BOOKABLE;
}

/**
 * September availability calendar. Every in-window day is a real link into
 * the booking flow with that date preselected — nothing here is decorative.
 */
export function AvailabilityCalendar() {
  const cells: (number | null)[] = [
    ...Array.from({ length: LEADING_BLANKS }, () => null),
    ...Array.from({ length: DAYS_IN_MONTH }, (_, index) => index + 1),
  ];

  return (
    <div className="w-full max-w-lg">
      <h2 className="mb-10 text-center font-display text-4xl leading-[1.1] tracking-tight text-ink md:text-5xl xl:text-right">
        Check room availability
        <br />
        on this calendar
      </h2>

      <div className="rounded-[2.5rem] border border-line bg-surface/90 p-6 shadow-[0_40px_100px_-20px_rgba(25,26,28,0.12)] backdrop-blur-3xl sm:p-10">
        <div className="mb-8 flex items-center justify-between px-1">
          <span className="text-lg font-semibold tracking-tight text-ink sm:text-2xl">{MONTH.label}</span>
          <span className="text-xs font-medium tracking-[0.14em] text-ink-subtle uppercase">Select a date</span>
        </div>

        <div className="mb-4 grid grid-cols-7 gap-1.5 text-center text-xs font-semibold tracking-widest text-ink-subtle uppercase">
          {WEEKDAY_HEADER.map((day, index) => (
            <div key={`${day}-${index}`} aria-hidden>
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-x-1.5 gap-y-2 text-center text-sm font-medium">
          {cells.map((day, index) => {
            if (day === null) return <div key={`pad-${index}`} aria-hidden />;
            if (!inWindow(day)) {
              return (
                <div
                  key={day}
                  className="mx-auto flex size-10 items-center justify-center rounded-full text-ink-subtle/50"
                  aria-label={`September ${day}, 2026 — out of season`}
                >
                  {day}
                </div>
              );
            }
            const date = `2026-09-${String(day).padStart(2, '0')}`;
            const isWeekend = index % 7 >= 5;
            return (
              <Link
                key={day}
                href={`${STAYS}?checkIn=${date}` as Route}
                aria-label={`September ${day}, 2026 — find rooms from this date`}
                className="mx-auto flex size-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-ink hover:text-white focus-visible:bg-ink focus-visible:text-white"
              >
                {isWeekend ? <span className="text-caution">{day}</span> : day}
              </Link>
            );
          })}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-line pt-6 text-xs text-ink-subtle">
          <span className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-ink" aria-hidden /> open for booking
          </span>
          <span className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-caution" aria-hidden /> weekend pricing
          </span>
          <span className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-line-strong" aria-hidden /> out of season
          </span>
        </div>
      </div>
    </div>
  );
}
