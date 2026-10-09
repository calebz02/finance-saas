import { z } from "zod";
import { Hono } from "hono";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { clerkMiddleware } from "@hono/clerk-auth";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { 
  transactions, 
  categories,
  accounts
} from "@/db/schema";
import { resolveDateRange } from "@/lib/dates";
import { requireAuth } from "@/server/http/auth";
import { notFound } from "@/server/http/errors";
import { idParamSchema, validationHook } from "@/server/http/validation";
import { assertAccountsOwned, assertCategoriesOwned } from "@/server/ownership";
import {
  bulkCreateTransactionsSchema,
  createTransactionSchema,
  transactionRangeQuerySchema,
  updateTransactionSchema,
  type TransactionListItem,
  type TransactionResponse,
} from "@/lib/schemas/transaction";

type TransactionInput = z.output<typeof createTransactionSchema>;

// The only place API keys (`amount`, `date`) are mapped to columns, in both directions.
const transactionResponseColumns = {
  id: transactions.id,
  amount: transactions.amountCents,
  date: transactions.transactionDate,
  payee: transactions.payee,
  notes: transactions.notes,
  accountId: transactions.accountId,
  categoryId: transactions.categoryId,
};

const toTransactionValues = (input: TransactionInput) => ({
  accountId: input.accountId,
  categoryId: input.categoryId,
  amountCents: input.amount,
  transactionDate: input.date,
  payee: input.payee,
  notes: input.notes,
});

const app = new Hono()
  .use(clerkMiddleware(), requireAuth)
  .get(
    "/",
    zValidator("query", transactionRangeQuerySchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const { accountId, ...range } = c.req.valid("query");

      const { from, to } = resolveDateRange(range);

      const data: TransactionListItem[] = await db
        .select({
          ...transactionResponseColumns,
          category: categories.name,
          account: accounts.name,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        // Tenant filter in the join: a foreign category_id shows as uncategorized, never as its name.
        .leftJoin(categories, and(
          eq(transactions.categoryId, categories.id),
          eq(categories.userId, userId),
        ))
        .where(
          and(
            accountId ? eq(transactions.accountId, accountId) : undefined,
            eq(accounts.userId, userId),
            gte(transactions.transactionDate, from),
            lte(transactions.transactionDate, to),
          )
        )
        .orderBy(desc(transactions.transactionDate));

      return c.json({ data });
  })
  .get(
    "/:id",
    zValidator("param", idParamSchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");

      const [data]: (TransactionResponse | undefined)[] = await db
        .select(transactionResponseColumns)
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .where(
          and(
            eq(transactions.id, id),
            eq(accounts.userId, userId),
          ),
        );
      
      if (!data) {
        throw notFound();
      }

      return c.json({ data });
    }
  )
  .post(
    "/",
    zValidator("json", createTransactionSchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const values = c.req.valid("json");

      await assertAccountsOwned(userId, [values.accountId]);
      await assertCategoriesOwned(userId, [values.categoryId]);

      const [data]: TransactionResponse[] = await db.insert(transactions).values({
        id: createId(),
        ...toTransactionValues(values),
      }).returning(transactionResponseColumns);

      return c.json({ data });
  })
  .post(
    "/bulk-create",
    zValidator("json", bulkCreateTransactionsSchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const values = c.req.valid("json");

      // Two set-based checks for the whole file; any foreign ID rejects every row.
      await assertAccountsOwned(userId, values.map((value) => value.accountId));
      await assertCategoriesOwned(userId, values.map((value) => value.categoryId));

      // One multi-row INSERT is atomic, so the import is all-or-nothing.
      const data: TransactionResponse[] = await db
        .insert(transactions)
        .values(
          values.map((value) => ({
            id: createId(),
            ...toTransactionValues(value),
          }))
        )
        .returning(transactionResponseColumns);
        
      return c.json({ data });
    },
  )
  .post(
    "/bulk-delete",
    zValidator(
      "json",
      z.object({
        ids: z.array(z.string()),
      }),
      validationHook,
    ),
    async (c) => {
      const userId = c.get("userId");
      const values = c.req.valid("json");

      const transactionsToDelete = db.$with("transactions_to_delete").as(
        db.select({ id: transactions.id }).from(transactions)
          .innerJoin(accounts, eq(transactions.accountId, accounts.id))
          .where(and(
            inArray(transactions.id, values.ids),
            eq(accounts.userId, userId),
          )),
      );

      const data = await db
        .with(transactionsToDelete)
        .delete(transactions)
        .where(
          inArray(transactions.id, sql`(select id from ${transactionsToDelete})`)
        )
        .returning({
          id: transactions.id,
        });

      return c.json({ data });
    },
  )
  .patch(
    "/:id",
    zValidator("param", idParamSchema, validationHook),
    zValidator("json", updateTransactionSchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const values = c.req.valid("json");

      // Body references first (422); the path ID is checked by the scoped UPDATE (404).
      await assertAccountsOwned(userId, [values.accountId]);
      await assertCategoriesOwned(userId, [values.categoryId]);

      const transactionsToUpdate = db.$with("transactions_to_update").as(
        db.select({ id: transactions.id })
          .from(transactions)
          .innerJoin(accounts, eq(transactions.accountId, accounts.id))
          .where(and(
            eq(transactions.id, id),
            eq(accounts.userId, userId),
          )),
      );

      const [data]: (TransactionResponse | undefined)[] = await db
        .with(transactionsToUpdate)
        .update(transactions)
        .set(toTransactionValues(values))
        .where(
          inArray(transactions.id, sql`(select id from ${transactionsToUpdate})`)
        )
        .returning(transactionResponseColumns);

      if (!data) {
        throw notFound();
      }

      return c.json({ data });
    },
  )
  .delete(
    "/:id",
    zValidator("param", idParamSchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");

      const transactionsToDelete = db.$with("transactions_to_delete").as(
        db.select({ id: transactions.id })
          .from(transactions)
          .innerJoin(accounts, eq(transactions.accountId, accounts.id))
          .where(and(
            eq(transactions.id, id),
            eq(accounts.userId, userId),
          )),
      );

      const [data] = await db
        .with(transactionsToDelete)
        .delete(transactions)
        .where(
          inArray(
            transactions.id,
            sql`(select id from ${transactionsToDelete})`
          ),
        )
        .returning({
          id: transactions.id,
        });

      if (!data) {
        throw notFound();
      }

      return c.json({ data });
    },
  );

export default app;
