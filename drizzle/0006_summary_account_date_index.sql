-- Motivated by the dashboard summary queries in server/summary.ts
-- (WHERE accounts.user_id = $user AND transaction_date BETWEEN $from AND $to).
-- Baseline plans: Parallel Seq Scan over all of transactions, discarding ~97% of
-- rows by date before the account join. Equality column first, range column second.
-- See docs/benchmarks.md.
CREATE INDEX IF NOT EXISTS "transactions_account_id_transaction_date_idx" ON "transactions" ("account_id","transaction_date");
