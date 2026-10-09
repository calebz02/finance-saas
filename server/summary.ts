import "server-only";

import { and, desc, eq, gte, lt, lte, sql, sum } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { accounts, categories, transactions } from "@/db/schema";
import { previousPeriod, type DateOnly } from "@/lib/dates";
import { calculatePercentageChange, fillMissingDays } from "@/lib/utils";

export type SummaryRange = {
  from: DateOnly;
  to: DateOnly;
  accountId?: string;
};

// SUM over zero rows is NULL; an empty period is 0 cents.
function periodTotalsQuery(userId: string, from: DateOnly, to: DateOnly, accountId?: string) {
  return db
    .select({
      income: sql`COALESCE(SUM(CASE WHEN ${transactions.amountCents} > 0 THEN ${transactions.amountCents} ELSE 0 END), 0)`.mapWith(Number),
      expenses: sql`COALESCE(SUM(CASE WHEN ${transactions.amountCents} < 0 THEN ${transactions.amountCents} ELSE 0 END), 0)`.mapWith(Number),
      remaining: sql`COALESCE(${sum(transactions.amountCents)}, 0)`.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        accountId ? eq(transactions.accountId, accountId) : undefined,
        eq(accounts.userId, userId),
        gte(transactions.transactionDate, from),
        lte(transactions.transactionDate, to),
      ),
    );
}

function categoryTotalsQuery(userId: string, from: DateOnly, to: DateOnly, accountId?: string) {
  // No matching category row (NULL category_id, or one that isn't the caller's) groups as "Uncategorized".
  const categoryName = sql<string>`COALESCE(${categories.name}, 'Uncategorized')`;

  return db
    .select({
      name: categoryName,
      value: sql`SUM(ABS(${transactions.amountCents}))`.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(
      categories,
      and(
        eq(transactions.categoryId, categories.id),
        eq(categories.userId, userId),
      ),
    )
    .where(
      and(
        accountId ? eq(transactions.accountId, accountId) : undefined,
        eq(accounts.userId, userId),
        lt(transactions.amountCents, 0),
        gte(transactions.transactionDate, from),
        lte(transactions.transactionDate, to),
      ),
    )
    .groupBy(categoryName)
    .orderBy(desc(sql`SUM(ABS(${transactions.amountCents}))`));
}

function dailyTotalsQuery(userId: string, from: DateOnly, to: DateOnly, accountId?: string) {
  return db
    .select({
      date: transactions.transactionDate,
      income: sql`SUM(CASE WHEN ${transactions.amountCents} > 0 THEN ${transactions.amountCents} ELSE 0 END)`.mapWith(Number),
      expenses: sql`SUM(CASE WHEN ${transactions.amountCents} < 0 THEN ABS(${transactions.amountCents}) ELSE 0 END)`.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        accountId ? eq(transactions.accountId, accountId) : undefined,
        eq(accounts.userId, userId),
        gte(transactions.transactionDate, from),
        lte(transactions.transactionDate, to),
      ),
    )
    .groupBy(transactions.transactionDate)
    .orderBy(transactions.transactionDate);
}

/** The four dashboard queries, exported so the benchmark can EXPLAIN the exact production SQL. */
export function summaryQueries(userId: string, { from, to, accountId }: SummaryRange) {
  const last = previousPeriod(from, to);

  return {
    currentPeriod: periodTotalsQuery(userId, from, to, accountId),
    lastPeriod: periodTotalsQuery(userId, last.from, last.to, accountId),
    categories: categoryTotalsQuery(userId, from, to, accountId),
    days: dailyTotalsQuery(userId, from, to, accountId),
  };
}

/** `from` and `to` are already resolved (inclusive); the previous period is derived here. */
export async function getSummary(userId: string, range: SummaryRange) {
  const queries = summaryQueries(userId, range);

  // neon-http sends each awaited query as its own HTTPS request; a batch is one request.
  const [[currentPeriod], [lastPeriod], category, activeDays] = await db.batch([
    queries.currentPeriod,
    queries.lastPeriod,
    queries.categories,
    queries.days,
  ]);

  const topCategories = category.slice(0, 3);
  const otherCategories = category.slice(3);
  const otherSum = otherCategories.reduce((sum, current) => sum + current.value, 0);

  const finalCategories = topCategories;
  if (otherCategories.length > 0) {
    finalCategories.push({
      name: "Other",
      value: otherSum,
    });
  }

  // Every amount is integer cents. `expensesAmount` is negative; per-day
  // `expenses` and category `value` are positive magnitudes, as in V1.
  return {
    remainingAmount: currentPeriod.remaining,
    remainingChange: calculatePercentageChange(currentPeriod.remaining, lastPeriod.remaining),
    incomeAmount: currentPeriod.income,
    incomeChange: calculatePercentageChange(currentPeriod.income, lastPeriod.income),
    expensesAmount: currentPeriod.expenses,
    expensesChange: calculatePercentageChange(currentPeriod.expenses, lastPeriod.expenses),
    categories: finalCategories,
    days: fillMissingDays(activeDays, range.from, range.to),
  };
}
