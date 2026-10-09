import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { clerkMiddleware } from "@hono/clerk-auth";

import { resolveDateRange } from "@/lib/dates";
import { transactionRangeQuerySchema } from "@/lib/schemas/transaction";
import { requireAuth } from "@/server/http/auth";
import { validationHook } from "@/server/http/validation";
import { getSummary } from "@/server/summary";

const app = new Hono()
  .use(clerkMiddleware(), requireAuth)
  .get(
    "/",
    zValidator("query", transactionRangeQuerySchema, validationHook),
    async (c) => {
      const userId = c.get("userId");
      const { accountId, ...range } = c.req.valid("query");
      const { from, to } = resolveDateRange(range);

      const data = await getSummary(userId, { from, to, accountId });

      return c.json({ data });
    },
  );

export default app;
