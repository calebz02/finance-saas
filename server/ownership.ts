import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { accounts, categories } from "@/db/schema";
import { invalidReference } from "@/server/http/errors";

/*
 * Transactions have no user_id; they belong to whoever owns their account.
 * The database cannot enforce "this account/category belongs to the caller",
 * so every write that accepts these IDs from a request body calls these first.
 *
 * Each helper is one query for the whole set, so a 5,000-row CSV import costs
 * two ownership queries, not 10,000. IDs are primary keys, so after
 * deduplication the set is fully owned exactly when every ID comes back.
 */

const distinct = (ids: readonly (string | null | undefined)[]) =>
  Array.from(new Set(ids.filter((id): id is string => id != null)));

export async function assertAccountsOwned(userId: string, accountIds: readonly string[]) {
  const ids = distinct(accountIds);
  if (ids.length === 0) return;

  const owned = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.id, ids)));

  if (owned.length !== ids.length) {
    throw invalidReference("accountId");
  }
}

/** `null` / `undefined` mean "uncategorized" and need no check. */
export async function assertCategoriesOwned(
  userId: string,
  categoryIds: readonly (string | null | undefined)[],
) {
  const ids = distinct(categoryIds);
  if (ids.length === 0) return;

  const owned = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), inArray(categories.id, ids)));

  if (owned.length !== ids.length) {
    throw invalidReference("categoryId");
  }
}
