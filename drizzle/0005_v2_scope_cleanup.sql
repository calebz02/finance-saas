-- Scope cleanup: budgets and multi-currency are not part of the final product.
-- Postgres drops the CHECKs from 0004 with their table/column
-- (budgets_month_first_day_check, budgets_amount_positive_check,
-- accounts_currency_code_format_check), so no DROP CONSTRAINT is needed.
DROP TABLE "budgets";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "currency_code";
