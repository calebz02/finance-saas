import { z } from "zod";

import { isDateOnly } from "@/lib/dates";
import { MAX_ABS_AMOUNT_CENTS } from "@/lib/money";

/**
 * The transaction API contract (V2). JSON keys match what the UI already
 * reads; their meaning is:
 *
 *   amount  integer cents, positive = income, negative = expense
 *   date    "YYYY-MM-DD" calendar day (Postgres DATE), never a timestamp
 *
 * Deliberately independent of db/schema.ts: column names (`amount_cents`,
 * `transaction_date`) and server-owned fields (`plaid_transaction_id`,
 * timestamps) are not part of the contract.
 */

export const amountCentsSchema = z
  .number()
  .int("Amount must be whole cents")
  .min(-MAX_ABS_AMOUNT_CENTS, "Amount must be at least -$10,000,000.00")
  .max(MAX_ABS_AMOUNT_CENTS, "Amount must be at most $10,000,000.00");

export const dateOnlySchema = z
  .string()
  .refine(isDateOnly, "Date must be a real calendar day in YYYY-MM-DD format");

const transactionFields = {
  accountId: z.string().min(1, "Account is required"),
  categoryId: z.string().nullable().optional(),
  amount: amountCentsSchema,
  date: dateOnlySchema,
  payee: z.string().trim().min(1, "Payee is required").max(255),
  notes: z.string().nullable().optional(),
};

export const createTransactionSchema = z.object(transactionFields);

/** PATCH replaces every editable field, as the edit form always sends the full object. */
export const updateTransactionSchema = z.object(transactionFields);

/** One CSV row before the user picks the destination account. */
export const importTransactionRowSchema = createTransactionSchema.omit({ accountId: true });

/** Keeps the single multi-row INSERT well under Postgres's 65,535 bind-parameter limit. */
export const MAX_BULK_CREATE_ROWS = 5000;

export const bulkCreateTransactionsSchema = z
  .array(createTransactionSchema)
  .min(1, "Nothing to import")
  .max(MAX_BULK_CREATE_ROWS, `Import at most ${MAX_BULK_CREATE_ROWS} rows at a time`);

// Query params arrive as "" when the UI has no filter set; treat that as absent.
const optionalDateOnly = z
  .string()
  .optional()
  .transform((value) => value || undefined)
  .pipe(dateOnlySchema.optional());

export const transactionRangeQuerySchema = z
  .object({
    from: optionalDateOnly,
    to: optionalDateOnly,
    accountId: z.string().optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    message: "`from` must be on or before `to`",
    path: ["from"],
  });

export const transactionResponseSchema = z.object({
  id: z.string(),
  amount: z.number().int(),
  date: dateOnlySchema,
  payee: z.string(),
  notes: z.string().nullable(),
  accountId: z.string(),
  categoryId: z.string().nullable(),
});

export const transactionListItemSchema = transactionResponseSchema.extend({
  account: z.string(),
  category: z.string().nullable(),
});

export type CreateTransactionInput = z.input<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.input<typeof updateTransactionSchema>;
export type ImportTransactionRow = z.input<typeof importTransactionRowSchema>;
export type TransactionResponse = z.infer<typeof transactionResponseSchema>;
export type TransactionListItem = z.infer<typeof transactionListItemSchema>;
