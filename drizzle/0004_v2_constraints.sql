-- Hand-written: drizzle-kit 0.21 cannot generate CHECK constraints.
-- Mirror of the list at the top of db/schema.ts. The tables are empty after
-- 0003_v2_reset, so each ADD CONSTRAINT validates instantly.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 100);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_code_format_check"
  CHECK ("currency_code" ~ '^[A-Z]{3}$');
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plaid_link_check"
  CHECK (("bank_connection_id" IS NULL) = ("plaid_account_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 100);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payee_length_check"
  CHECK (char_length("payee") BETWEEN 1 AND 255);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_month_first_day_check"
  CHECK (EXTRACT(DAY FROM "month") = 1);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_amount_positive_check"
  CHECK ("amount_cents" > 0);
