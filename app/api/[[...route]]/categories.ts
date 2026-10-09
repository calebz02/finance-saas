import { z } from "zod";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { clerkMiddleware } from "@hono/clerk-auth";

import { db } from "@/db/drizzle";
import { categories } from "@/db/schema";
import { requireAuth } from "@/server/http/auth";
import { notFound } from "@/server/http/errors";
import { idParamSchema, validationHook } from "@/server/http/validation";
import {
  createCategorySchema,
  updateCategorySchema,
  type CategoryResponse,
} from "@/lib/schemas/category";

const categoryResponseColumns = {
  id: categories.id,
  name: categories.name,
};

const app = new Hono()
  .use(clerkMiddleware(), requireAuth)
  .get(
    "/",
    async (c) => {
      const userId = c.get("userId");

      const data: CategoryResponse[] = await db
        .select(categoryResponseColumns)
        .from(categories)
        .where(eq(categories.userId, userId));

      return c.json({ data });
  })
  .get(
    "/:id",
    zValidator("param", idParamSchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");

      const [data]: (CategoryResponse | undefined)[] = await db
        .select(categoryResponseColumns)
        .from(categories)
        .where(
          and(
            eq(categories.userId, userId),
            eq(categories.id, id)
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
    zValidator("json", createCategorySchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const values = c.req.valid("json");

      const [data]: CategoryResponse[] = await db.insert(categories).values({
        id: createId(),
        userId,
        name: values.name,
      }).returning(categoryResponseColumns);

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
        .delete(categories)
        .where(
          and(
            eq(categories.userId, userId),
            inArray(categories.id, values.ids)
          )
        )
        .returning({
          id: categories.id,
        });

      return c.json({ data });
    },
  )
  .patch(
    "/:id",
    zValidator("param", idParamSchema, validationHook),
    zValidator("json", updateCategorySchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const values = c.req.valid("json");

      const [data]: (CategoryResponse | undefined)[] = await db
        .update(categories)
        .set({ name: values.name })
        .where(
          and(
            eq(categories.userId, userId),
            eq(categories.id, id),
          ),
        )
        .returning(categoryResponseColumns);

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
        .delete(categories)
        .where(
          and(
            eq(categories.userId, userId),
            eq(categories.id, id),
          ),
        )
        .returning({
          id: categories.id,
        });

      if (!data) {
        throw notFound();
      }

      return c.json({ data });
    },
  );

export default app;
