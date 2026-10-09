import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db/drizzle";
import { accounts, transactions } from "@/db/schema";
import { onError } from "@/server/http/errors";
import summaryRouter from "@/app/api/[[...route]]/summary";
import transactionsRouter from "@/app/api/[[...route]]/transactions";

import { truncateAll } from "./helpers";

// Same Clerk stand-in as tests/unit/require-auth.test.ts: user id comes from a header.
vi.mock("@hono/clerk-auth", () => ({
  getAuth: (c: { get: (key: string) => unknown }) => c.get("clerkAuth"),
  clerkMiddleware: () => async (
    c: { req: { header: (name: string) => string | undefined }; set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("clerkAuth", { userId: c.req.header("x-test-user-id") ?? null });
    await next();
  },
}));

const USER = "user_day2_alice";
const headers = { "x-test-user-id": USER, "content-type": "application/json" };

const app = new Hono();
app.onError(onError);
app.route("/transactions", transactionsRouter).route("/summary", summaryRouter);

const ORIGINAL_TZ = process.env.TZ;
let accountId: string;

beforeAll(() => {
  // UTC+14: any accidental Date round trip on the server would move the day.
  process.env.TZ = "Pacific/Kiritimati";
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

beforeEach(async () => {
  await truncateAll();
  accountId = createId();
  await db.insert(accounts).values({ id: accountId, userId: USER, name: "Checking" });
});

describe("transaction API contract against Postgres", () => {
  it("stores integer cents and a DATE, and returns them unchanged", async () => {
    const created = await app.request("/transactions", {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId, amount: -1234, date: "2026-10-02", payee: "Coffee", categoryId: null, notes: null }),
    });
    expect(created.status).toBe(200);
    const { data } = await created.json();
    expect(data).toMatchObject({ amount: -1234, date: "2026-10-02", payee: "Coffee", accountId });

    const [row] = await db
      .select({
        amountCents: transactions.amountCents,
        transactionDate: transactions.transactionDate,
        asText: sql<string>`${transactions.transactionDate}::text`,
      })
      .from(transactions)
      .where(eq(transactions.id, data.id));
    expect(row).toEqual({ amountCents: -1234, transactionDate: "2026-10-02", asText: "2026-10-02" });

    // `to` is inclusive: a transaction on the last day of the range is returned.
    const list = await app.request("/transactions?from=2026-10-02&to=2026-10-02", { headers });
    expect((await list.json()).data).toEqual([
      expect.objectContaining({ id: data.id, amount: -1234, date: "2026-10-02", account: "Checking", category: null }),
    ]);

    const single = await app.request(`/transactions/${data.id}`, { headers });
    expect((await single.json()).data).toMatchObject({ amount: -1234, date: "2026-10-02" });

    const edited = await app.request(`/transactions/${data.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ accountId, amount: 250000, date: "2026-10-31", payee: "Refund", categoryId: null, notes: null }),
    });
    expect((await edited.json()).data).toMatchObject({ amount: 250000, date: "2026-10-31", payee: "Refund" });
  });

  it("rejects V1-shaped payloads (dollar floats, ISO timestamps) with 400 and inserts nothing", async () => {
    const base = { accountId, payee: "Coffee", categoryId: null, notes: null };

    for (const body of [
      { ...base, amount: 12.34, date: "2026-10-02" },
      { ...base, amount: -1234, date: "2026-10-02T04:00:00.000Z" },
    ]) {
      const res = await app.request("/transactions", { method: "POST", headers, body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }

    const bulk = await app.request("/transactions/bulk-create", {
      method: "POST",
      headers,
      body: JSON.stringify([{ ...base, amount: 100, date: "2026-10-02" }, { ...base, amount: 100, date: "10/02/2026" }]),
    });
    expect(bulk.status).toBe(400);

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(transactions);
    expect(count).toBe(0);
  });

  it("returns summary totals in cents with the V2 sign convention and date-only days", async () => {
    const row = (amountCents: number, transactionDate: string) => ({
      id: createId(),
      accountId,
      amountCents,
      transactionDate,
      payee: "Merchant",
    });

    await db.insert(transactions).values([
      row(500000, "2026-10-01"),
      row(-1234, "2026-10-02"),
      row(-766, "2026-10-02"),
      row(0, "2026-10-02"),
      row(-1000, "2026-09-30"), // previous period
    ]);

    const res = await app.request("/summary?from=2026-10-01&to=2026-10-02", { headers });
    const { data } = await res.json();

    expect(data).toMatchObject({
      incomeAmount: 500000,
      expensesAmount: -2000,
      remainingAmount: 498000,
      days: [
        { date: "2026-10-01", income: 500000, expenses: 0 },
        { date: "2026-10-02", income: 0, expenses: 2000 },
      ],
    });

    const empty = await app.request("/summary?from=2020-01-01&to=2020-01-31", { headers });
    expect((await empty.json()).data).toMatchObject({
      incomeAmount: 0,
      expensesAmount: 0,
      remainingAmount: 0,
      days: [],
    });
  });
});
