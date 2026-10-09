import { format } from "date-fns";
import { afterEach, describe, expect, it } from "vitest";

import {
  addDays,
  eachDateOnly,
  isDateOnly,
  parseCsvDate,
  parseDateOnly,
  previousPeriod,
  toDateOnly,
} from "@/lib/dates";

// Node re-reads TZ when it is assigned, so each test can run "in" a different zone.
const ORIGINAL_TZ = process.env.TZ;
const ZONES = [
  "Pacific/Pago_Pago", // UTC-11
  "America/Los_Angeles", // UTC-7 / -8
  "UTC",
  "Asia/Tokyo", // UTC+9
  "Pacific/Kiritimati", // UTC+14
];

const inZone = (zone: string, fn: () => void) => {
  process.env.TZ = zone;
  fn();
};

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("business date ↔ date-picker Date", () => {
  it("actually switches timezone between zones (guards the tests below)", () => {
    const offsets = ZONES.map((zone) => {
      process.env.TZ = zone;
      return new Date(2026, 0, 15).getTimezoneOffset();
    });

    expect(new Set(offsets).size).toBe(ZONES.length);
  });

  it.each(ZONES)("keeps the picked calendar day in %s", (zone) => {
    inZone(zone, () => {
      // react-day-picker hands back local midnight of the clicked day.
      const picked = new Date(2026, 9, 2);
      expect(toDateOnly(picked)).toBe("2026-10-02");

      // A late-evening Date is still that local day, not tomorrow in UTC.
      expect(toDateOnly(new Date(2026, 9, 2, 23, 59))).toBe("2026-10-02");
    });
  });

  it.each(ZONES)("renders a stored date-only string as the same day in %s", (zone) => {
    inZone(zone, () => {
      const local = parseDateOnly("2026-10-02");

      expect([local.getFullYear(), local.getMonth(), local.getDate()]).toEqual([2026, 9, 2]);
      expect(format(local, "yyyy-MM-dd")).toBe("2026-10-02");
      expect(toDateOnly(parseDateOnly("2024-02-29"))).toBe("2024-02-29");
    });
  });

  it("documents the bug parseDateOnly avoids: new Date('YYYY-MM-DD') is UTC midnight", () => {
    inZone("America/Los_Angeles", () => {
      expect(new Date("2026-10-02").getDate()).toBe(1);
      expect(parseDateOnly("2026-10-02").getDate()).toBe(2);
    });
  });

  it("rejects anything that is not a strict, real YYYY-MM-DD day", () => {
    expect(isDateOnly("2026-10-02")).toBe(true);
    expect(isDateOnly("2024-02-29")).toBe(true);

    for (const value of ["2026-02-29", "2026-13-01", "2026-10-32", "2026-10-2", "2026-10-02T00:00:00Z", "10/02/2026", ""]) {
      expect(isDateOnly(value)).toBe(false);
    }

    expect(() => parseDateOnly("2026-02-30")).toThrow(RangeError);
    expect(() => toDateOnly(new Date("garbage"))).toThrow(RangeError);
  });
});

describe("calendar arithmetic on date strings", () => {
  it("does not gain or lose a day across a DST change", () => {
    inZone("America/Los_Angeles", () => {
      // US DST starts 2026-03-08; spring-forward days are 23h long locally.
      expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
      expect(eachDateOnly("2026-03-07", "2026-03-09")).toEqual([
        "2026-03-07",
        "2026-03-08",
        "2026-03-09",
      ]);
    });
  });

  it("computes the equal-length previous period across month, year, and leap boundaries", () => {
    expect(previousPeriod("2026-10-01", "2026-10-31")).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    expect(previousPeriod("2026-01-01", "2026-01-10")).toEqual({ from: "2025-12-22", to: "2025-12-31" });
    expect(previousPeriod("2024-03-01", "2024-03-01")).toEqual({ from: "2024-02-29", to: "2024-02-29" });
  });
});

describe("parseCsvDate", () => {
  it.each([
    ["2026-10-02", "2026-10-02"],
    ["2026-10-02 23:59:59", "2026-10-02"],
    ["2026-10-02 00:00:00", "2026-10-02"],
    ["10/02/2026", "2026-10-02"],
    ["02/29/2024", "2024-02-29"],
    ["  2026-10-02  ", "2026-10-02"],
  ])("normalizes the whitelisted format %j to %j", (input, expected) => {
    expect(parseCsvDate(input)).toEqual({ ok: true, date: expected });
  });

  it.each(ZONES)("takes the written date literally, with no timezone shift, in %s", (zone) => {
    inZone(zone, () => {
      expect(parseCsvDate("2026-10-02 23:30:00")).toEqual({ ok: true, date: "2026-10-02" });
      expect(parseCsvDate("2026-10-02 00:30:00")).toEqual({ ok: true, date: "2026-10-02" });
    });
  });

  it.each([
    ["02/30/2026", /real calendar date/],
    ["2026-02-29", /real calendar date/],
    ["13/01/2026", /real calendar date/], // day-first file: month 13 does not exist
    ["2026-10-02 24:00:00", /time of day/],
    ["2026-10-02 12:60:00", /time of day/],
  ])("rejects the impossible value %j", (input, message) => {
    const result = parseCsvDate(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it.each([
    "2/3/2026", // unpadded: not the whitelisted MM/dd/yyyy
    "02/03/26", // two-digit year
    "2026/10/02",
    "02-10-2026",
    "2026-10-02T10:00:00Z",
    "2026-10-02 10:00",
    "Oct 2, 2026",
    "",
  ])("rejects the non-whitelisted or ambiguous format %j", (input) => {
    const result = parseCsvDate(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unsupported date format/);
  });
});
