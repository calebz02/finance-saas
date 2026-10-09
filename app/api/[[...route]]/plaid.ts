import { z } from "zod";
import { Hono } from "hono";
import { and, eq, isNotNull } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { 
  Configuration, 
  CountryCode, 
  PlaidApi, 
  PlaidEnvironments, 
  Products
} from "plaid";

import { db } from "@/db/drizzle";
import { 
  accounts, 
  bankConnections, 
  categories, 
  transactions
} from "@/db/schema";
import { isPlaidEnabled } from "@/server/feature-flags";
import { notFound } from "@/server/http/errors";

const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_TOKEN,
      "PLAID-SECRET": process.env.PLAID_SECRET_TOKEN,
    },
  },
});

const client = new PlaidApi(configuration);

const app = new Hono()
  // Runs before auth and every handler: when disabled, no route here touches Plaid or the database.
  .use(async (_c, next) => {
    if (!isPlaidEnabled()) {
      throw notFound();
    }

    await next();
  })
  .get(
    "/connected-bank",
    clerkMiddleware(),
    async (c) => {
      const auth = getAuth(c);

      if (!auth?.userId) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      // Never select access_token: it grants read access to the user's bank data.
      const [connectedBank] = await db
        .select({
          id: bankConnections.id,
          institutionName: bankConnections.institutionName,
          lastSyncedAt: bankConnections.lastSyncedAt,
        })
        .from(bankConnections)
        .where(
          eq(
            bankConnections.userId,
            auth.userId,
          ),
        );

      return c.json({ data: connectedBank || null });
    },
  )
  .delete(
    "/connected-bank",
    clerkMiddleware(),
    async (c) => {
      const auth = getAuth(c);

      if (!auth?.userId) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const [connectedBank] = await db
        .delete(bankConnections)
        .where(
          eq(
            bankConnections.userId,
            auth.userId,
          ),
        )
        .returning({
          id: bankConnections.id,
        });

      if (!connectedBank) {
        return c.json({ error: "Not found" }, 404);
      }

      await db
        .delete(categories)
        .where(
          and(
            eq(categories.userId, auth.userId),
            isNotNull(categories.plaidCategory),
          ),
        );

      return c.json({ data: connectedBank });
    },
  )
  .post(
    "/create-link-token",
    clerkMiddleware(),
    async (c) => {
      const auth = getAuth(c);

      if (!auth?.userId) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const token = await client.linkTokenCreate({
        user: {
          client_user_id: auth.userId,
        },
        client_name: "Finance Tutorial",
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: "en",
      });

      return c.json({ data: token.data.link_token }, 200);
    },
  )
  .post(
    "/exchange-public-token",
    clerkMiddleware(),
    zValidator(
      "json",
      z.object({
        publicToken: z.string(),
      }),
    ),
    async (c) => {
      const auth = getAuth(c);
      const { publicToken } = c.req.valid("json");

      if (!auth?.userId) {
        return c.json({ error: "Unauthorized" }, 401);
      }

     const exchange = await client.itemPublicTokenExchange({
      public_token: publicToken,
     });

     const [connectedBank] = await db
      .insert(bankConnections)
      .values({
        id: createId(),
        userId: auth.userId,
        plaidItemId: exchange.data.item_id,
        accessToken: exchange.data.access_token,
      })
      .returning();

      const plaidTransactions = await client.transactionsSync({
        access_token: connectedBank.accessToken,
      });

      const plaidAccounts = await client.accountsGet({
        access_token: connectedBank.accessToken,
      });

      const plaidCategories = await client.categoriesGet({});

      const newAccounts = await db
        .insert(accounts)
        .values(
          plaidAccounts.data.accounts.map((account) => ({
            id: createId(),
            name: account.name,
            bankConnectionId: connectedBank.id,
            plaidAccountId: account.account_id,
            userId: auth.userId,
          })),
        )
        .returning();

      const newCategories = await db
        .insert(categories)
        .values(
          plaidCategories.data.categories.map((category) => ({
            id: createId(),
            name: category.hierarchy.join(", "),
            plaidCategory: category.category_id,
            userId: auth.userId,
          })),
        )
        .returning();

      const newTransactionsValues = plaidTransactions.data.added
        .reduce((acc, transaction) => {
          const account = newAccounts
            .find((account) => account.plaidAccountId === transaction.account_id);
          const category = newCategories
            .find((category) => category.plaidCategory === transaction.category_id);

          if (account) {
            acc.push({
              id: createId(),
              amountCents: Math.round(transaction.amount * 100),
              payee: transaction.merchant_name || transaction.name,
              notes: transaction.name,
              transactionDate: transaction.date,
              accountId: account.id,
              categoryId: category?.id,
            });
          }
          
          return acc;
        }, [] as typeof transactions.$inferInsert[]);

      if (newTransactionsValues.length > 0) {
        await db
          .insert(transactions)
          .values(newTransactionsValues);
      }

      return c.json({ ok: true }, 200);
    },
  );

export default app;
