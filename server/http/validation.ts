import "server-only";

import { z, type ZodError } from "zod";

import { badRequest } from "@/server/http/errors";

export const idParamSchema = z.object({
  id: z.string().min(1),
});

/**
 * Third argument to `zValidator`. Its default 400 body is a raw ZodError;
 * throwing here sends validation failures through `onError` and the envelope.
 * Typed without Hono's generics so it never pins the route's Env or path.
 */
export const validationHook = (result: { success: boolean; error?: ZodError }) => {
  if (result.success) {
    return;
  }

  const issue = result.error?.issues[0];

  if (!issue) {
    throw badRequest("Invalid request");
  }

  const field = issue.path.join(".");
  throw badRequest(field ? `${field}: ${issue.message}` : issue.message);
};
