import { Hono } from "hono";
import { createId } from "@paralleldrive/cuid2";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db/drizzle";
import { accounts, categories, transactions } from "@/db/schema";
import { onError } from "@/server/http/errors";
import summaryRouter from "@/app/api/[[...route]]/summary";
import { TEST_USER_HEADER } from "@/tests/support/clerk-auth";

import { truncateAll } from "./helpers";

vi.mock("@hono/clerk-auth", () => import("@/tests/support/clerk-auth"));

const app = new Hono();
app.onError(onError);
app.route("/summary", summaryRouter);

const USER = "user_day4_summary";
const OTHER = "user_day4_other";
const FROM = "2026-10-01";
const TO = "2026-10-31";

const ids = {
  account: createId(),
  food: createId(),
  otherAccount: createId(),
};

const tx = (accountId: string, amountCents: number, categoryId: string | null, transactionDate = "2026-10-15") => ({
  id: createId(),
  accountId,
  categoryId,
  amountCents,
  transactionDate,
  payee: "Payee",
});

const fetchSummary = async (userId: string) => {
  const res = await app.request(`/summary?from=${FROM}&to=${TO}`, { headers: { [TEST_USER_HEADER]: userId } });
  expect(res.status).toBe(200);
  return (await res.json()).data;
};

beforeEach(async () => {
  await truncateAll();
  await db.insert(accounts).values([
    { id: ids.account, userId: USER, name: "Checking" },
    { id: ids.otherAccount, userId: OTHER, name: "Other checking" },
  ]);
  await db.insert(categories).values([{ id: ids.food, userId: USER, name: "Food" }]);
  await db.insert(transactions).values([
    tx(ids.account, -1000, ids.food),
    tx(ids.account, -500, null),
    tx(ids.account, -300, null, TO),
    tx(ids.account, 2000, null),               // income: not part of the spending breakdown
    tx(ids.account, -4000, null, "2026-09-30"), // outside the range
    tx(ids.otherAccount, -9999, null),          // another tenant's uncategorized expense
  ]);
});

describe("summary totals", () => {
  // Locks the dashboard output so query/index changes cannot alter results.
  it("matches hand-computed income, expenses, net, changes, categories, and daily values", async () => {
    const data = await fetchSummary(USER);

    expect(data.incomeAmount).toBe(2000);
    expect(data.expensesAmount).toBe(-1800);
    expect(data.remainingAmount).toBe(200);

    // Previous period is 2026-08-31..2026-09-30: only the -4000 expense.
    expect(data.incomeChange).toBe(100);
    expect(data.expensesChange).toBeCloseTo(-55);
    expect(data.remainingChange).toBeCloseTo(-105);

    expect(data.categories).toEqual([
      { name: "Food", value: 1000 },
      { name: "Uncategorized", value: 800 },
    ]);

    expect(data.days).toHaveLength(31);
    expect(data.days[0]).toEqual({ date: FROM, income: 0, expenses: 0 });
    expect(data.days.filter((day: { income: number; expenses: number }) => day.income || day.expenses)).toEqual([
      { date: "2026-10-15", income: 2000, expenses: 1500 },
      { date: TO, income: 0, expenses: 300 },
    ]);
  });
});

describe("summary category breakdown", () => {
  it("names categorized expenses and groups NULL-category expenses as Uncategorized", async () => {
    const data = await fetchSummary(USER);

    expect(data.categories).toEqual([
      { name: "Food", value: 1000 },
      { name: "Uncategorized", value: 800 },
    ]);
    expect(data.expensesAmount).toBe(-1800);
  });

  it("never mixes in another tenant's uncategorized expenses", async () => {
    expect((await fetchSummary(OTHER)).categories).toEqual([{ name: "Uncategorized", value: 9999 }]);
  });
});
