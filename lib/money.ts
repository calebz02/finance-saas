/**
 * Canonical money model: integer cents, positive = inflow (income),
 * negative = outflow (expense). Assumes two-decimal currencies; no FX.
 *
 * Isomorphic: used by the transaction form, CSV import, and API DTOs.
 */

/** ±$10M per transaction. Well inside the INTEGER column's ±$21,474,836.47. */
export const MAX_ABS_AMOUNT_CENTS = 1_000_000_000;

// 13 integer digits × 100 stays below 2^53, so every step below is exact integer math.
const MAX_INTEGER_DIGITS = 13;

const MONEY_PATTERN =
  /^(?<leadingSign>[+-])?(?<currency>\$)?(?<innerSign>[+-])?(?<integer>[\d,]*)(?:\.(?<fraction>\d*))?$/;
const UNGROUPED_INTEGER = /^\d*$/;
const GROUPED_INTEGER = /^\d{1,3}(?:,\d{3})+$/;

export type MoneyParseResult =
  | { ok: true; cents: number }
  | { ok: false; error: string };

const fail = (error: string): MoneyParseResult => ({ ok: false, error });

/**
 * Parses a user- or CSV-supplied decimal string into integer cents using
 * string/integer arithmetic only, so "0.29" is 29 rather than
 * Math.round(0.29 * 100) on a binary float.
 *
 * Accepts: `12.34`, `-12.34`, `+12`, `.5`, `12.`, `$1,234.56`, `-$5`, `$-5`,
 * `(12.00)`, `($12.00)`, and trailing zeros past the cent (`1.2300`).
 * Rejects anything else rather than guessing, including European
 * separators (`1.234,56`, `12,34`), sub-cent values (`1.005`), conflicting
 * signs (`-(5)`), embedded spaces, and other currency symbols.
 */
export function parseMoneyToCents(input: string): MoneyParseResult {
  let text = input.trim();

  if (text === "") {
    return fail("Amount is required");
  }

  const parenthesized = text.startsWith("(") && text.endsWith(")");
  if (parenthesized) {
    text = text.slice(1, -1).trim();
  }

  const match = MONEY_PATTERN.exec(text);
  if (!match?.groups) {
    return fail("Unsupported amount format");
  }

  const { leadingSign, innerSign, integer = "" } = match.groups;
  const fraction = match.groups.fraction ?? "";

  if ((leadingSign && innerSign) || (parenthesized && (leadingSign || innerSign))) {
    return fail("Use one sign: a minus sign or parentheses, not both");
  }

  if (integer === "" && fraction === "") {
    return fail("Amount must contain digits");
  }

  if (!UNGROUPED_INTEGER.test(integer) && !GROUPED_INTEGER.test(integer)) {
    return fail("Thousands separators must group digits in threes (1,234.56)");
  }

  if (fraction.length > 2 && !/^0+$/.test(fraction.slice(2))) {
    return fail("Amount cannot be more precise than one cent");
  }

  const integerDigits = integer.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (integerDigits.length > MAX_INTEGER_DIGITS) {
    return fail("Amount is too large");
  }

  const cents =
    Number(integerDigits || "0") * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
  const negative = parenthesized || leadingSign === "-" || innerSign === "-";

  return { ok: true, cents: negative && cents !== 0 ? -cents : cents };
}

/** Display-only: a float in major units for charts and axis labels. Never feed it back into storage. */
export const centsToAmount = (cents: number) => cents / 100;

/** Exact decimal string for editable inputs: -1234 → "-12.34", 5 → "0.05". */
export function centsToDecimalString(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const fraction = String(abs % 100).padStart(2, "0");

  return `${sign}${Math.trunc(abs / 100)}.${fraction}`;
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

/** -1234 → "-$12.34". The app is USD-only. */
export const formatCents = (cents: number) => usdFormatter.format(centsToAmount(cents));
