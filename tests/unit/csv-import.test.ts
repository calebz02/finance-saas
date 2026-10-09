import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import { formatImportRowError, normalizeImportRows } from "@/lib/csv-import";
import { bulkCreateTransactionsSchema } from "@/lib/schemas/transaction";

const SMOKE_TEST_CSV = [
  "date,payee,amount",
  "2026-10-02,Trader Joe's,-45.67",
  "10/03/2026,Salary,1234.56",
  "2026-10-04 14:30:00,Netflix,(19.99)",
  "",
].join("\n");

/** Same call react-papaparse's CSVReader makes: default config, one row per `step`. */
function parseLikeCsvReader(text: string) {
  const data: string[][] = [];
  Papa.parse<string[]>(text, { step: (result) => { data.push(result.data); } });
  return { headers: data[0], body: data.slice(1) };
}

describe("CSV import: browser smoke-test rows", () => {
  const byHeader = (headers: string[]) => headers.map((header) => header.trim());

  it("normalizes all three rows to canonical cents and business dates", () => {
    const { headers, body } = parseLikeCsvReader(SMOKE_TEST_CSV);

    const result = normalizeImportRows(body, byHeader(headers));

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { date: "2026-10-02", payee: "Trader Joe's", amount: -4567 },
      { date: "2026-10-03", payee: "Salary", amount: 123456 },
      { date: "2026-10-04", payee: "Netflix", amount: -1999 },
    ]);
  });

  it("validates without accountId, then passes the bulk-create DTO once one is added", () => {
    const { headers, body } = parseLikeCsvReader(SMOKE_TEST_CSV);
    const { rows } = normalizeImportRows(body, byHeader(headers));

    expect(rows.every((row) => !("accountId" in row))).toBe(true);
    expect(bulkCreateTransactionsSchema.safeParse(rows).success).toBe(false);

    const withAccount = rows.map((row) => ({ ...row, accountId: "acc_1" }));
    expect(bulkCreateTransactionsSchema.parse(withAccount)).toEqual(withAccount);
  });

  it.each([
    ["CRLF", SMOKE_TEST_CSV.replace(/\n/g, "\r\n")],
    ["BOM + CRLF", `\uFEFF${SMOKE_TEST_CSV.replace(/\n/g, "\r\n")}`],
  ])("parses the same rows from a %s file", (_label, text) => {
    const { body } = parseLikeCsvReader(text);

    const result = normalizeImportRows(body, ["date", "payee", "amount"]);

    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.amount)).toEqual([-4567, 123456, -1999]);
  });

  it("reports one readable error per row when the payee and amount columns are swapped", () => {
    const { body } = parseLikeCsvReader(SMOKE_TEST_CSV);

    const { rows, errors } = normalizeImportRows(body, ["date", "amount", "payee"]);

    expect(rows).toEqual([]);
    expect(errors.map(formatImportRowError)).toEqual([
      'Row 2: amount — Unsupported amount format (got "Trader Joe\'s")',
      'Row 3: amount — Unsupported amount format (got "Salary")',
      'Row 4: amount — Unsupported amount format (got "Netflix")',
    ]);
  });

  it("reports schema issues by field and omits an empty value", () => {
    const { errors } = normalizeImportRows([["2026-10-02", "  ", "1.00"]], ["date", "payee", "amount"]);

    expect(errors.map(formatImportRowError)).toEqual(["Row 2: payee — Payee is required"]);
  });
});
