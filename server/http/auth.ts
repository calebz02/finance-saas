import "server-only";

import { getAuth } from "@hono/clerk-auth";
import { createMiddleware } from "hono/factory";

import { unauthorized } from "@/server/http/errors";

export type AuthEnv = {
  Variables: {
    userId: string;
  };
};

/**
 * Must run after `clerkMiddleware()`. If Clerk never ran, `getAuth` returns
 * undefined and the request is rejected (fail closed).
 */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const auth = getAuth(c);

  if (!auth?.userId) {
    throw unauthorized();
  }

  c.set("userId", auth.userId);
  await next();
});
