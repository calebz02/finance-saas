/**
 * Three kinds of time live in this app and must not be mixed:
 *
 * - Business dates (`transactions.transaction_date DATE`): a calendar day,
 *   carried everywhere as a "YYYY-MM-DD" string. No time, no zone.
 * - UI dates: JS `Date` objects at local midnight, used only inside
 *   date-picker / calendar components. Convert at the component boundary
 *   with `toDateOnly` and `parseDateOnly`.
 * - System timestamps (`created_at`, `updated_at`, `last_synced_at`):
 *   real instants, `TIMESTAMPTZ` in Postgres and `Date` in server code.
 *
 * Never call `new Date("YYYY-MM-DD")`: it is UTC midnight, which renders as
 * the previous day anywhere west of UTC.
 */

export type DateOnly = string;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isCalendarDate = (year: number, month: number, day: number) =>
  year >= 1 &&
  month >= 1 &&
  month <= 12 &&
  day >= 1 &&
  day <= (month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]);

const pad = (value: number, width: number) => String(value).padStart(width, "0");

const fromParts = (year: number, month: number, day: number): DateOnly =>
  `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

/** True only for a strict "YYYY-MM-DD" string naming a real calendar day. */
export function isDateOnly(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  return !!match && isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function splitDateOnly(value: DateOnly): [number, number, number] {
  if (!isDateOnly(value)) {
    throw new RangeError(`Expected a YYYY-MM-DD calendar date, got "${value}"`);
  }

  const [year, month, day] = value.split("-").map(Number);
  return [year, month, day];
}

/** UI → business date: the calendar day the user sees in their own timezone. */
export function toDateOnly(date: Date): DateOnly {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Cannot convert an invalid Date to a calendar date");
  }

  return fromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Business date → UI: local midnight of that day, for date pickers and date-fns `format`. */
export function parseDateOnly(value: DateOnly): Date {
  const [year, month, day] = splitDateOnly(value);
  const date = new Date(year, month - 1, day);
  // The Date constructor maps years 0–99 to 1900–1999.
  date.setFullYear(year);
  return date;
}

/** Today's calendar day in the timezone of whoever calls it (browser or server). */
export const todayDateOnly = (now: Date = new Date()) => toDateOnly(now);

// Day arithmetic in UTC, where every day is exactly 24h, so DST never adds or drops a day.
function toEpochDay(value: DateOnly) {
  const [year, month, day] = splitDateOnly(value);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.round(date.getTime() / MS_PER_DAY);
}

function fromEpochDay(epochDay: number): DateOnly {
  const date = new Date(epochDay * MS_PER_DAY);
  return fromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export const addDays = (value: DateOnly, days: number) =>
  fromEpochDay(toEpochDay(value) + days);

export const daysBetweenInclusive = (from: DateOnly, to: DateOnly) =>
  toEpochDay(to) - toEpochDay(from) + 1;

export function eachDateOnly(from: DateOnly, to: DateOnly): DateOnly[] {
  const start = toEpochDay(from);
  const length = toEpochDay(to) - start + 1;
  return Array.from({ length: Math.max(length, 0) }, (_, index) => fromEpochDay(start + index));
}

/** The equal-length window immediately before [from, to], both ends inclusive. */
export function previousPeriod(from: DateOnly, to: DateOnly) {
  const length = daysBetweenInclusive(from, to);
  return { from: addDays(from, -length), to: addDays(to, -length) };
}

/**
 * Fills a missing `from`/`to` with the last 30 days ending today. "Today" is
 * the caller's clock, so on the server it is the server's day, not the user's.
 */
export function resolveDateRange(
  range: { from?: DateOnly; to?: DateOnly },
  today: DateOnly = todayDateOnly(),
) {
  return {
    from: range.from ?? addDays(today, -30),
    to: range.to ?? today,
  };
}

export const CSV_DATE_FORMATS = ["yyyy-MM-dd", "yyyy-MM-dd HH:mm:ss", "MM/dd/yyyy"] as const;

const CSV_DATE_PATTERNS = [
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})$/,
  /^(?<month>\d{2})\/(?<day>\d{2})\/(?<year>\d{4})$/,
];

export type DateParseResult =
  | { ok: true; date: DateOnly }
  | { ok: false; error: string };

/**
 * Normalizes a CSV date cell to "YYYY-MM-DD". Only the formats in
 * `CSV_DATE_FORMATS` are accepted; a time of day is validated and then
 * dropped (the date is taken as written, never shifted between zones).
 *
 * `MM/dd/yyyy` is read as US month-first. A day-first file is caught because
 * import is all-or-nothing and such a file almost always contains a day > 12.
 */
export function parseCsvDate(input: string): DateParseResult {
  const text = input.trim();

  for (const pattern of CSV_DATE_PATTERNS) {
    const groups = pattern.exec(text)?.groups;
    if (!groups) continue;

    const year = Number(groups.year);
    const month = Number(groups.month);
    const day = Number(groups.day);

    if (!isCalendarDate(year, month, day)) {
      return { ok: false, error: "Not a real calendar date" };
    }

    if (
      groups.hour !== undefined &&
      (Number(groups.hour) > 23 || Number(groups.minute) > 59 || Number(groups.second) > 59)
    ) {
      return { ok: false, error: "Invalid time of day" };
    }

    return { ok: true, date: fromParts(year, month, day) };
  }

  return {
    ok: false,
    error: `Unsupported date format; use ${CSV_DATE_FORMATS.join(", ")}`,
  };
}
