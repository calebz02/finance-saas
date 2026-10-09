import { and, eq, isNull } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { eachDayOfInterval, format, subDays } from "date-fns";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { accounts, categories, transactions } from "@/db/schema";

export const CLERK_USER_ID_PATTERN = /^user_\w+$/;

const SEED_DAYS = 90;
const CATEGORY_NAMES = ["Food", "Rent", "Utilities", "Clothing"] as const;
const ACCOUNT_NAMES = ["Checking", "Savings"] as const;

type CategoryName = (typeof CATEGORY_NAMES)[number];

const randomDollars = (category: CategoryName, random: () => number) => {
  switch (category) {
    case "Rent":
      return random() * 400 + 90;
    case "Utilities":
      return random() * 200 + 50;
    case "Food":
      return random() * 30 + 10;
    case "Clothing":
      return random() * 100 + 20;
  }
};

export const buildSeedRows = (
  userId: string,
  today: Date,
  random: () => number = Math.random,
) => {
  const seedCategories = CATEGORY_NAMES.map((name) => ({
    id: createId(),
    userId,
    name,
  }));

  const seedAccounts = ACCOUNT_NAMES.map((name) => ({
    id: createId(),
    userId,
    name,
  }));

  const seedTransactions = eachDayOfInterval({
    start: subDays(today, SEED_DAYS),
    end: today,
  }).flatMap((day) => {
    const count = Math.floor(random() * 4) + 1;

    return Array.from({ length: count }, () => {
      const categoryIndex = Math.floor(random() * seedCategories.length);
      const category = seedCategories[categoryIndex];
      const isExpense = random() > 0.6;
      const cents = Math.round(randomDollars(CATEGORY_NAMES[categoryIndex], random) * 100);

      return {
        id: createId(),
        accountId: seedAccounts[0].id,
        categoryId: category.id,
        amountCents: isExpense ? -cents : cents,
        transactionDate: format(day, "yyyy-MM-dd"),
        payee: "Merchant",
        notes: "Random transaction",
      };
    });
  });

  return {
    categories: seedCategories,
    accounts: seedAccounts,
    transactions: seedTransactions,
  };
};

/**
 * Replaces one user's manual demo data in a single atomic batch.
 *
 * Deletes are scoped to `userId` and to manual rows only. Plaid-owned rows are
 * kept because deleting them without resetting `bank_connections.sync_cursor`
 * would leave the cursor claiming data the database no longer has.
 */
export async function seedUser<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
  userId: string,
  today: Date = new Date(),
) {
  if (!CLERK_USER_ID_PATTERN.test(userId)) {
    throw new Error(`Refusing to seed: "${userId}" is not a Clerk user id (user_...)`);
  }

  const rows = buildSeedRows(userId, today);

  await db.batch([
    db.delete(accounts).where(
      and(eq(accounts.userId, userId), isNull(accounts.bankConnectionId)),
    ),
    db.delete(categories).where(
      and(eq(categories.userId, userId), isNull(categories.plaidCategory)),
    ),
    db.insert(categories).values(rows.categories),
    db.insert(accounts).values(rows.accounts),
    db.insert(transactions).values(rows.transactions),
  ]);

  return {
    categories: rows.categories.length,
    accounts: rows.accounts.length,
    transactions: rows.transactions.length,
  };
}
