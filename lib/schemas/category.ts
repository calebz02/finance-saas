import { z } from "zod";

/**
 * The category API contract. Independent of db/schema.ts: `user_id` comes
 * from the session, and `plaid_category` and timestamps are server-owned, so
 * none of them can be sent or are ever returned.
 */

const categoryFields = {
  // Matches categories_name_length_check.
  name: z.string().trim().min(1, "Name is required").max(100),
};

export const createCategorySchema = z.object(categoryFields);

export const updateCategorySchema = z.object(categoryFields);

export const categoryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type CreateCategoryInput = z.input<typeof createCategorySchema>;
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;
export type CategoryResponse = z.infer<typeof categoryResponseSchema>;
