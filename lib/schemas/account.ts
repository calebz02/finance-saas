import { z } from "zod";

/**
 * The account API contract. Independent of db/schema.ts: `user_id` comes from
 * the session, and Plaid fields and timestamps are server-owned, so none of
 * them can be sent or are ever returned.
 */

const accountFields = {
  // Matches accounts_name_length_check.
  name: z.string().trim().min(1, "Name is required").max(100),
};

export const createAccountSchema = z.object(accountFields);

export const updateAccountSchema = z.object(accountFields);

export const accountResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;
