import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db/drizzle";
import { accounts, categories, transactions } from "@/db/schema";
import { onError } from "@/server/http/errors";
import accountsRouter from "@/app/api/[[...route]]/accounts";
import categoriesRouter from "@/app/api/[[...route]]/categories";
import summaryRouter from "@/app/api/[[...route]]/summary";
import transactionsRouter from "@/app/api/[[...route]]/transactions";

import { truncateAll } from "./helpers";

vi.mock("@hono/clerk-auth", () => import("@/tests/support/clerk-auth"));

const app = new Hono();
app.onError(onError);
app
  .route("/accounts", accountsRouter)
  .route("/categories", categoriesRouter)
  .route("/summary", summaryRouter)
  .route("/transactions", transactionsRouter);

// A is the victim, B is the caller in every test.
const USER_A = "user_day3_a";
const USER_B = "user_day3_b";
const asB = { "x-test-user-id": USER_B, "content-type": "application/json" };

const ids = {
  accountA: createId(),
  categoryA: createId(),
  transactionA: createId(),
  accountB: createId(),
  categoryB: createId(),
  transactionB: createId(),
};

const DATE = "2026-10-02";
const row = (accountId: string, categoryId: string | null = null) => ({
  accountId,
  categoryId,
  amount: -1234,
  date: DATE,
  payee: "Coffee",
  notes: null,
});

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: asB, body: body === undefined ? undefined : JSON.stringify(body) });

const invalid = (field: "accountId" | "categoryId") => ({
  error: { code: "UNPROCESSABLE", message: `Invalid ${field}` },
});

const transactionCount = async () => {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(transactions);
  return count;
};

const storedTransaction = async (id: string) => {
  const [stored] = await db
    .select({ accountId: transactions.accountId, categoryId: transactions.categoryId, payee: transactions.payee })
    .from(transactions)
    .where(eq(transactions.id, id));
  return stored;
};

beforeEach(async () => {
  await truncateAll();
  await db.insert(accounts).values([
    { id: ids.accountA, userId: USER_A, name: "A checking" },
    { id: ids.accountB, userId: USER_B, name: "B checking" },
  ]);
  await db.insert(categories).values([
    { id: ids.categoryA, userId: USER_A, name: "A secret category" },
    { id: ids.categoryB, userId: USER_B, name: "B food" },
  ]);
  await db.insert(transactions).values([
    { id: ids.transactionA, accountId: ids.accountA, categoryId: ids.categoryA, amountCents: -500, transactionDate: DATE, payee: "A payee" },
    { id: ids.transactionB, accountId: ids.accountB, categoryId: null, amountCents: -700, transactionDate: DATE, payee: "B payee" },
  ]);
});

describe("transaction writes check body references (422)", () => {
  it("B cannot create a transaction in A's account, and the error does not reveal that it exists", async () => {
    const foreign = await send("POST", "/transactions", row(ids.accountA));
    const missing = await send("POST", "/transactions", row("does_not_exist"));

    expect(foreign.status).toBe(422);
    expect(await foreign.json()).toEqual(invalid("accountId"));
    expect(missing.status).toBe(422);
    expect(await missing.json()).toEqual(invalid("accountId"));
    expect(await transactionCount()).toBe(2);
  });

  it("B cannot attach A's category, but can attach their own", async () => {
    const foreign = await send("POST", "/transactions", row(ids.accountB, ids.categoryA));
    expect(foreign.status).toBe(422);
    expect(await foreign.json()).toEqual(invalid("categoryId"));
    expect(await transactionCount()).toBe(2);

    const own = await send("POST", "/transactions", row(ids.accountB, ids.categoryB));
    expect(own.status).toBe(200);
    expect(await transactionCount()).toBe(3);
  });

  it("B cannot bulk-create into A's account", async () => {
    const res = await send("POST", "/transactions/bulk-create", [row(ids.accountA), row(ids.accountA)]);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(invalid("accountId"));
    expect(await transactionCount()).toBe(2);
  });

  it("a mixed-validity bulk request inserts nothing; the same file without the foreign row inserts every row", async () => {
    const valid = [row(ids.accountB), row(ids.accountB, ids.categoryB), row(ids.accountB, ids.categoryB)];

    const mixed = await send("POST", "/transactions/bulk-create", [...valid, row(ids.accountB, ids.categoryA)]);
    expect(mixed.status).toBe(422);
    expect(await mixed.json()).toEqual(invalid("categoryId"));
    expect(await transactionCount()).toBe(2);

    // Repeated and null IDs are deduplicated / skipped, so they don't fail the set comparison.
    const clean = await send("POST", "/transactions/bulk-create", valid);
    expect(clean.status).toBe(200);
    expect(await transactionCount()).toBe(5);
  });

  it("B cannot PATCH their own transaction into A's account", async () => {
    const res = await send("PATCH", `/transactions/${ids.transactionB}`, row(ids.accountA));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(invalid("accountId"));
    expect(await storedTransaction(ids.transactionB)).toEqual({ accountId: ids.accountB, categoryId: null, payee: "B payee" });
  });

  it("B cannot PATCH their own transaction to A's category", async () => {
    const res = await send("PATCH", `/transactions/${ids.transactionB}`, row(ids.accountB, ids.categoryA));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(invalid("categoryId"));
    expect(await storedTransaction(ids.transactionB)).toEqual({ accountId: ids.accountB, categoryId: null, payee: "B payee" });
  });
});

describe("reads and deletes stay tenant-scoped (404)", () => {
  it("B cannot read, edit, or delete A's transaction", async () => {
    const list = await send("GET", `/transactions?from=${DATE}&to=${DATE}`);
    expect((await list.json()).data.map((t: { id: string }) => t.id)).toEqual([ids.transactionB]);

    const notFound = { error: { code: "NOT_FOUND", message: "Not found" } };
    for (const res of [
      await send("GET", `/transactions/${ids.transactionA}`),
      await send("PATCH", `/transactions/${ids.transactionA}`, row(ids.accountB)),
      await send("DELETE", `/transactions/${ids.transactionA}`),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(notFound);
    }

    const bulkDelete = await send("POST", "/transactions/bulk-delete", { ids: [ids.transactionA] });
    expect((await bulkDelete.json()).data).toEqual([]);

    expect(await storedTransaction(ids.transactionA)).toEqual({ accountId: ids.accountA, categoryId: ids.categoryA, payee: "A payee" });
  });

  it("never returns another tenant's category name, even if a row already references it", async () => {
    // Only possible by bypassing the API (legacy data, a manual fix, a future bug).
    await db.update(transactions).set({ categoryId: ids.categoryA }).where(eq(transactions.id, ids.transactionB));

    const list = await send("GET", `/transactions?from=${DATE}&to=${DATE}`);
    expect((await list.json()).data).toEqual([expect.objectContaining({ id: ids.transactionB, category: null })]);

    // Counted, but as uncategorized: A's category name never reaches B.
    const summary = await send("GET", `/summary?from=${DATE}&to=${DATE}`);
    expect((await summary.json()).data.categories).toEqual([{ name: "Uncategorized", value: 700 }]);
  });
});

describe("authentication and response shape", () => {
  it("rejects unauthenticated requests to every core router with a 401 envelope", async () => {
    for (const path of ["/accounts", "/categories", "/summary", "/transactions"]) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    }
  });

  it("account and category writes return only { id, name }", async () => {
    for (const path of ["/accounts", "/categories"]) {
      const created = await (await send("POST", path, { name: "  Savings  " })).json();
      expect(created.data).toEqual({ id: expect.any(String), name: "Savings" });

      const edited = await (await send("PATCH", `${path}/${created.data.id}`, { name: "Renamed" })).json();
      expect(edited.data).toEqual({ id: created.data.id, name: "Renamed" });
    }
  });
});
