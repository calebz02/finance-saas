import { describe, expect, it } from "vitest";

import {
  MAX_BULK_CREATE_ROWS,
  bulkCreateTransactionsSchema,
  createTransactionSchema,
  transactionRangeQuerySchema,
} from "@/lib/schemas/transaction";

const valid = {
  accountId: "acc_1",
  categoryId: null,
  amount: -1234,
  date: "2026-10-02",
  payee: "  Coffee  ",
  notes: null,
};

describe("createTransactionSchema (API DTO)", () => {
  it("accepts integer cents and a date-only string", () => {
    expect(createTransactionSchema.parse(valid)).toEqual({ ...valid, payee: "Coffee" });
  });

  it.each([
    ["dollars instead of cents", { amount: 12.34 }],
    ["above the $10M cap", { amount: 1_000_000_001 }],
    ["a V1 ISO timestamp date", { date: "2026-10-02T04:00:00.000Z" }],
    ["an impossible calendar day", { date: "2026-02-30" }],
    ["a blank payee", { payee: "   " }],
    ["a missing account", { accountId: "" }],
  ])("rejects %s", (_label, override) => {
    expect(createTransactionSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});

describe("bulkCreateTransactionsSchema", () => {
  it("accepts 1 to MAX_BULK_CREATE_ROWS rows and rejects an empty or oversized import", () => {
    const rows = (n: number) => Array.from({ length: n }, () => valid);

    expect(bulkCreateTransactionsSchema.safeParse(rows(MAX_BULK_CREATE_ROWS)).success).toBe(true);
    expect(bulkCreateTransactionsSchema.safeParse(rows(MAX_BULK_CREATE_ROWS + 1)).success).toBe(false);
    expect(bulkCreateTransactionsSchema.safeParse([]).success).toBe(false);
  });
});

describe("transactionRangeQuerySchema", () => {
  it("treats empty filter params as absent", () => {
    expect(transactionRangeQuerySchema.parse({ from: "", to: "", accountId: "" })).toEqual({
      from: undefined,
      to: undefined,
      accountId: "",
    });
  });

  it("rejects malformed dates and inverted ranges", () => {
    expect(transactionRangeQuerySchema.safeParse({ from: "10/01/2026" }).success).toBe(false);
    expect(transactionRangeQuerySchema.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success).toBe(false);
    expect(transactionRangeQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-01" }).success).toBe(true);
  });
});
