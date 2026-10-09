import { z } from "zod";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { clerkMiddleware } from "@hono/clerk-auth";

import { db } from "@/db/drizzle";
import { accounts } from "@/db/schema";
import { requireAuth } from "@/server/http/auth";
import { notFound } from "@/server/http/errors";
import { idParamSchema, validationHook } from "@/server/http/validation";
import {
  createAccountSchema,
  updateAccountSchema,
  type AccountResponse,
} from "@/lib/schemas/account";

const accountResponseColumns = {
  id: accounts.id,
  name: accounts.name,
};

const app = new Hono()
  .use(clerkMiddleware(), requireAuth)
  .get(
    "/",
    async (c) => {
      const userId = c.get("userId");

      const data: AccountResponse[] = await db
        .select(accountResponseColumns)
        .from(accounts)
        .where(eq(accounts.userId, userId));

      return c.json({ data });
  })
  .get(
    "/:id",
    zValidator("param", idParamSchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");

      const [data]: (AccountResponse | undefined)[] = await db
        .select(accountResponseColumns)
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.id, id)
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
    zValidator("json", createAccountSchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const values = c.req.valid("json");

      const [data]: AccountResponse[] = await db.insert(accounts).values({
        id: createId(),
        userId,
        name: values.name,
      }).returning(accountResponseColumns);

      return c.json({ data });
  })
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

      const data = await db
        .delete(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            inArray(accounts.id, values.ids)
          )
        )
        .returning({
          id: accounts.id,
        });

      return c.json({ data });
    },
  )
  .patch(
    "/:id",
    zValidator("param", idParamSchema, validationHook),
    zValidator("json", updateAccountSchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const values = c.req.valid("json");

      const [data]: (AccountResponse | undefined)[] = await db
        .update(accounts)
        .set({ name: values.name })
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.id, id),
          ),
        )
        .returning(accountResponseColumns);

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

      const [data] = await db
        .delete(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.id, id),
          ),
        )
        .returning({
          id: accounts.id,
        });

      if (!data) {
        throw notFound();
      }

      return c.json({ data });
    },
  );

export default app;
