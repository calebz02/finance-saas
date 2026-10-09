import { twMerge } from "tailwind-merge";
import { type ClassValue, clsx } from "clsx";
import { format, subDays } from "date-fns";

import { eachDateOnly, isDateOnly, parseDateOnly, type DateOnly } from "@/lib/dates";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
};

export function calculatePercentageChange(
  current: number,
  previous: number,
) {
  if (previous === 0) {
    return previous === current ? 0 : 100;
  }

  return ((current - previous) / previous) * 100;
};

export function fillMissingDays(
  activeDays: {
    date: DateOnly,
    income: number;
    expenses: number;
  }[],
  startDate: DateOnly,
  endDate: DateOnly,
) {
  if (activeDays.length === 0) {
    return [];
  }

  const allDays = eachDateOnly(startDate, endDate);

  const transactionsByDay = allDays.map((day) => {
    const found = activeDays.find((d) => d.date === day);

    if (found) {
      return found;
    } else {
      return {
        date: day,
        income: 0,
        expenses: 0,
      };
    }
  });

  return transactionsByDay;
};

type Period = {
  from: DateOnly | Date | undefined;
  to: DateOnly | Date | undefined;
};

// URL params are business dates; a malformed one falls back to the default range.
const toLocalDate = (value: DateOnly | Date | undefined) => {
  if (typeof value !== "string") return value;
  return isDateOnly(value) ? parseDateOnly(value) : undefined;
};

export function formatDateRange (period?: Period) {
  const defaultTo = new Date();
  const defaultFrom = subDays(defaultTo, 30);
  const from = toLocalDate(period?.from);
  const to = toLocalDate(period?.to);

  if (!from) {
    return `${format(defaultFrom, "LLL dd")} - ${format(defaultTo, "LLL dd, y")}`;
  }

  if (to) {
    return `${format(from, "LLL dd")} - ${format(to, "LLL dd, y")}`;
  }

  return format(from, "LLL dd, y");
};

export function formatPercentage(
  value: number,
  options: { addPrefix?: boolean } = {
    addPrefix: false,
  },
) {
  const result = new Intl.NumberFormat("en-US", {
    style: "percent",
  }).format(value / 100);

  if (options.addPrefix && value > 0) {
    return `+${result}`;
  }

  return result;
};
