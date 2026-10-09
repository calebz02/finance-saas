import { describe, expect, it } from "vitest";

import {
  centsToDecimalString,
  formatCents,
  parseMoneyToCents,
} from "@/lib/money";

const cents = (input: string) => {
  const result = parseMoneyToCents(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse, got: ${result.error}`);
  return result.cents;
};

const errorFor = (input: string) => {
  const result = parseMoneyToCents(input);
  if (result.ok) throw new Error(`expected "${input}" to be rejected, got ${result.cents}`);
  return result.error;
};

describe("parseMoneyToCents", () => {
  it.each([
    ["12.34", 1234],
    ["-12.34", -1234],
    ["+7.10", 710],
    ["12", 1200],
    ["12.", 1200],
    ["0.5", 50],
    [".5", 50],
    ["-0.5", -50],
    ["  42.00  ", 4200],
  ])("parses the plain decimal %j as %i cents", (input, expected) => {
    expect(cents(input)).toBe(expected);
  });

  it.each([
    ["$1,234.56", 123456],
    ["1,234,567.89", 123456789],
    ["-$5", -500],
    ["$-5", -500],
  ])("accepts a dollar sign and grouped thousands: %j", (input, expected) => {
    expect(cents(input)).toBe(expected);
  });

  it.each([
    ["(12.00)", -1200],
    ["($1,234.56)", -123456],
    ["( 3.50 )", -350],
  ])("reads accounting parentheses %j as negative", (input, expected) => {
    expect(cents(input)).toBe(expected);
  });

  it("is exact where float multiplication is not", () => {
    // 0.29 * 100 === 28.999999999999996 and 1.15 * 100 === 114.99999999999999 in IEEE 754.
    expect(cents("0.29")).toBe(29);
    expect(cents("1.15")).toBe(115);
    expect(cents("9999999999999.99")).toBe(999_999_999_999_999);
  });

  it("allows trailing zeros past the cent but rejects real sub-cent precision", () => {
    expect(cents("1.2300")).toBe(123);
    expect(errorFor("1.005")).toMatch(/more precise than one cent/);
    expect(errorFor("0.001")).toMatch(/more precise than one cent/);
  });

  it("never returns negative zero", () => {
    expect(Object.is(cents("-0.00"), 0)).toBe(true);
    expect(Object.is(cents("(0)"), 0)).toBe(true);
  });

  it("rejects ambiguous European and mis-grouped separators instead of guessing", () => {
    expect(errorFor("12,34")).toMatch(/group digits in threes/);
    expect(errorFor("1,23.45")).toMatch(/group digits in threes/);
    expect(errorFor("1.234,56")).toBeTruthy();
  });

  it("rejects conflicting signs", () => {
    expect(errorFor("--5")).toMatch(/one sign/);
    expect(errorFor("-(5)")).toBeTruthy();
    expect(errorFor("(-5)")).toMatch(/one sign/);
    expect(errorFor("-$-5")).toMatch(/one sign/);
  });

  it.each([
    "",
    "   ",
    "$",
    ".",
    "-",
    "abc",
    "12.3.4",
    "1 234.56",
    "€12",
    "12.34-",
    "1e3",
    "0x10",
    "Infinity",
    "NaN",
  ])("rejects malformed input %j", (input) => {
    expect(parseMoneyToCents(input).ok).toBe(false);
  });

  it("rejects integers too long to stay exact", () => {
    expect(errorFor("10000000000000")).toMatch(/too large/);
  });
});

describe("cents display helpers", () => {
  it.each([
    [-1234, "-12.34"],
    [5, "0.05"],
    [-5, "-0.05"],
    [0, "0.00"],
    [100, "1.00"],
  ])("centsToDecimalString(%i) is %j and parses back to the same cents", (value, expected) => {
    expect(centsToDecimalString(value)).toBe(expected);
    expect(cents(centsToDecimalString(value))).toBe(value);
  });

  it("formats cents as USD", () => {
    expect(formatCents(-123456)).toBe("-$1,234.56");
    expect(formatCents(5)).toBe("$0.05");
  });
});
