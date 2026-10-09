import { relations } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/*
 * CHECK constraints live in hand-written migrations because drizzle-kit 0.21
 * cannot generate them (added in 0004_v2_constraints.sql; the currency and
 * budgets checks were dropped with their columns in 0005_v2_scope_cleanup.sql).
 * Keep this list in sync with the database:
 *
 *   accounts_name_length_check         char_length(name) BETWEEN 1 AND 100
 *   accounts_plaid_link_check          (bank_connection_id IS NULL) = (plaid_account_id IS NULL)
 *   categories_name_length_check       char_length(name) BETWEEN 1 AND 100
 *   transactions_payee_length_check    char_length(payee) BETWEEN 1 AND 255
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  // Applied by Drizzle on every .update() and onConflictDoUpdate(); raw SQL updates must set it themselves.
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const bankConnections = pgTable("bank_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  plaidItemId: text("plaid_item_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  institutionId: text("institution_id"),
  institutionName: text("institution_name"),
  syncCursor: text("sync_cursor"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "date" }),
  ...timestamps,
});

export const bankConnectionsRelations = relations(bankConnections, ({ many }) => ({
  accounts: many(accounts),
}));

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  bankConnectionId: text("bank_connection_id").references(() => bankConnections.id, {
    onDelete: "cascade",
  }),
  plaidAccountId: text("plaid_account_id"),
  ...timestamps,
}, (table) => ({
  userIdIdx: index("accounts_user_id_idx").on(table.userId),
  plaidAccountUnique: unique("accounts_bank_connection_id_plaid_account_id_unique")
    .on(table.bankConnectionId, table.plaidAccountId),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  bankConnection: one(bankConnections, {
    fields: [accounts.bankConnectionId],
    references: [bankConnections.id],
  }),
  transactions: many(transactions),
}));

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  plaidCategory: text("plaid_category"),
  ...timestamps,
}, (table) => ({
  plaidCategoryUnique: unique("categories_user_id_plaid_category_unique")
    .on(table.userId, table.plaidCategory),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  transactions: many(transactions),
}));

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id, {
    onDelete: "cascade",
  }).notNull(),
  categoryId: text("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  amountCents: integer("amount_cents").notNull(),
  transactionDate: date("transaction_date", { mode: "string" }).notNull(),
  payee: text("payee").notNull(),
  notes: text("notes"),
  plaidTransactionId: text("plaid_transaction_id"),
  ...timestamps,
}, (table) => ({
  plaidTransactionUnique: unique("transactions_account_id_plaid_transaction_id_unique")
    .on(table.accountId, table.plaidTransactionId),
  // Dashboard summary: account_id = ? (equality, one probe per owned account) AND
  // transaction_date BETWEEN ? AND ? (range). See docs/benchmarks.md.
  accountDateIdx: index("transactions_account_id_transaction_date_idx")
    .on(table.accountId, table.transactionDate),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
}));

// API contracts live in lib/schemas/{account,category,transaction}.ts, not here.

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  subscriptionId: text("subscription_id").notNull().unique(),
  status: text("status").notNull(),
  ...timestamps,
});
