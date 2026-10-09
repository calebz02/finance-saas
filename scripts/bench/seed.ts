import { config } from "dotenv";
import { Client } from "pg";

import { describeDatabaseUrl, resolveDatabaseUrl } from "../lib/database-targets";
import { assertBenchTarget, BENCH_USER_PREFIX, HEAVY_USER_ID } from "./guard";

config({ path: ".env.local" });

const HEAVY_TRANSACTIONS = 150_000;
const BACKGROUND_USERS = 70;
const FIRST_DATE = "2023-10-01";
const DAYS = 1096; // 2023-10-01 .. 2026-09-30 inclusive

const CATEGORY_NAMES = [
  "Salary", "Groceries", "Rent", "Utilities", "Dining", "Transport",
  "Shopping", "Health", "Entertainment", "Travel", "Insurance", "Subscriptions",
];
const ACCOUNT_NAMES = ["Checking", "Savings", "Credit Card", "Business"];
const PAYEES = [
  "Whole Foods", "Trader Joe's", "Shell", "Uber", "Amazon", "Netflix", "Spotify", "CVS",
  "Target", "Costco", "Delta", "Chipotle", "Starbucks", "Con Edison", "Landlord LLC", "Employer Inc",
];

/*
 * Everything is generated inside Postgres (generate_series + one INSERT ... SELECT
 * per table), so ~500k rows cost a handful of statements instead of 500k binds.
 * setseed() + md5-derived ids make reruns produce the same dataset.
 * Rows are inserted in date order across all tenants, like a real table that
 * fills up over time, so one tenant's rows are interleaved with everyone else's.
 */
const main = async () => {
  const url = resolveDatabaseUrl("bench");
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const { rows: [{ count }] } = await client.query<{ count: number }>(
      `SELECT ((SELECT count(*) FROM accounts WHERE left(user_id, length($1)) <> $1)
             + (SELECT count(*) FROM categories WHERE left(user_id, length($1)) <> $1))::int AS count`,
      [BENCH_USER_PREFIX],
    );
    assertBenchTarget({ host: client.host, database: client.database ?? "" }, count);

    console.log(`Seeding benchmark data into ${describeDatabaseUrl(url)}`);
    const started = Date.now();

    await client.query("BEGIN");
    await client.query("TRUNCATE transactions, accounts, categories");
    await client.query("SELECT setseed(0.42)");

    await client.query(
      `CREATE TEMP TABLE bench_users ON COMMIT DROP AS
       SELECT $1::text AS user_id, 3 AS account_count, 12 AS category_count, $2::int AS tx_count
       UNION ALL
       SELECT $3 || 'user_' || lpad(n::text, 3, '0'), 2 + n % 3, 8, 2000 + (n * 7919) % 6001
       FROM generate_series(1, $4::int) AS n`,
      [HEAVY_USER_ID, HEAVY_TRANSACTIONS, BENCH_USER_PREFIX, BACKGROUND_USERS],
    );

    await client.query(
      `INSERT INTO accounts (id, user_id, name)
       SELECT substr(md5('acct:' || u.user_id || ':' || a), 1, 24), u.user_id, ($1::text[])[a]
       FROM bench_users u, generate_series(1, u.account_count) AS a`,
      [ACCOUNT_NAMES],
    );

    await client.query(
      `INSERT INTO categories (id, user_id, name)
       SELECT substr(md5('cat:' || u.user_id || ':' || c), 1, 24), u.user_id, ($1::text[])[c]
       FROM bench_users u, generate_series(1, u.category_count) AS c`,
      [CATEGORY_NAMES],
    );

    // 10% income (category 1, "Salary"); expenses pick categories 2..N, 5% left uncategorized.
    // Expense size is skewed small: $1 + r^2 * $300.
    await client.query(
      `WITH draws AS (
         SELECT u.user_id, u.account_count, u.category_count, g.n,
                random() AS r_account, random() AS r_kind, random() AS r_amount,
                random() AS r_date, random() AS r_uncategorized, random() AS r_category, random() AS r_payee
         FROM bench_users u
         CROSS JOIN LATERAL generate_series(1, u.tx_count) AS g(n)
       ),
       rows AS (
         SELECT
           substr(md5('tx:' || d.user_id || ':' || d.n), 1, 24) AS id,
           substr(md5('acct:' || d.user_id || ':' || (1 + floor(d.r_account * d.account_count)::int)), 1, 24) AS account_id,
           CASE
             WHEN d.r_kind < 0.10 THEN substr(md5('cat:' || d.user_id || ':1'), 1, 24)
             WHEN d.r_uncategorized < 0.05 THEN NULL
             ELSE substr(md5('cat:' || d.user_id || ':' || (2 + floor(d.r_category * (d.category_count - 1))::int)), 1, 24)
           END AS category_id,
           CASE
             WHEN d.r_kind < 0.10 THEN 50000 + floor(d.r_amount * 450000)::int
             ELSE -(100 + floor(d.r_amount * d.r_amount * 30000)::int)
           END AS amount_cents,
           $1::date + floor(d.r_date * $2::int)::int AS transaction_date,
           ($3::text[])[1 + floor(d.r_payee * array_length($3::text[], 1))::int] AS payee
         FROM draws d
       )
       INSERT INTO transactions (id, account_id, category_id, amount_cents, transaction_date, payee)
       SELECT id, account_id, category_id, amount_cents, transaction_date, payee
       FROM rows
       ORDER BY transaction_date, id`,
      [FIRST_DATE, DAYS, PAYEES],
    );

    await client.query("COMMIT");

    // Fresh planner statistics and a set visibility map, as autovacuum would leave a long-lived table.
    await client.query("VACUUM ANALYZE accounts, categories, transactions");

    const { rows: [counts] } = await client.query(
      `SELECT
         (SELECT count(*) FROM transactions)::int AS transactions,
         (SELECT count(*) FROM accounts)::int AS accounts,
         (SELECT count(*) FROM categories)::int AS categories,
         (SELECT count(DISTINCT user_id) FROM accounts)::int AS users,
         (SELECT count(*) FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = $1)::int AS heavy_user_transactions,
         (SELECT min(transaction_date)::text FROM transactions) AS first_date,
         (SELECT max(transaction_date)::text FROM transactions) AS last_date,
         pg_size_pretty(pg_total_relation_size('transactions')) AS transactions_size`,
      [HEAVY_USER_ID],
    );
    console.log(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s:`, counts);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error("Benchmark seed failed:", error);
  process.exit(1);
});
