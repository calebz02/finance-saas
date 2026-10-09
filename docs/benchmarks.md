# Dashboard summary benchmark

One measured optimization of `GET /api/summary` (`getSummary` in `server/summary.ts`).
Raw plans and JSON for every run are in `docs/benchmarks/<run>/`.

## Setup

| | |
|---|---|
| Database | Neon `bench` branch, AWS us-east-2, PostgreSQL 18.6, `shared_buffers` 230MB |
| Client | Developer laptop → Neon over neon-http (the production driver) |
| Data | 501,471 transactions, 71 users, 213 accounts, 572 categories, 2023-10-01 .. 2026-09-30 |
| Measured tenant | `bench_heavy`: 3 accounts, 12 categories, 150,000 transactions (~10% income, ~5% of expenses uncategorized) |
| Ranges | 30d: 2026-09-01..2026-09-30 (4,129 of the tenant's rows) · 365d: 2025-10-01..2026-09-30 (50,102 rows) |

`bun run bench:seed` generates the data inside Postgres (`generate_series`, `setseed`, md5 ids), inserts rows in date order across all tenants, then runs `VACUUM ANALYZE`. It refuses to run unless the connection is `DATABASE_URL_BENCH`, distinct from dev and test, and holds no non-`bench_` users (`scripts/bench/guard.ts`).

`bun run bench:summary <label>` measures two things separately:
- **Postgres execution time:** `EXPLAIN (ANALYZE, BUFFERS)` on the exact SQL `getSummary` sends (`summaryQueries().toSQL()`), with 3 warm-ups, then the median of 10 runs per query. The table reports the sum of the four medians.
- **Wall-clock time:** `getSummary()` through neon-http, with 5 warm-ups, then 25 measured runs, reporting p50 and nearest-rank p95.

A SHA-256 of the `getSummary` result is recorded for each run. It is identical in all three runs, so the results did not change.

Caveats: `EXPLAIN ANALYZE` adds per-row timing overhead, so its numbers are best compared with each other, not with wall-clock time. Every buffer was a `shared hit` (the data fits in memory), so this measures rows processed, not disk I/O. Network latency varied between runs: the neon-http `SELECT 1` p50 was 34.07, 30.55, and 24.34 ms.

## Baseline (`docs/benchmarks/baseline/`)

`getSummary` runs four queries: current-period totals, previous-period totals, the category breakdown, and the daily series. Each one is `transactions JOIN accounts WHERE accounts.user_id = $1 AND transaction_date BETWEEN $2 AND $3`, awaited one after another.

What the plans show, for every query and both ranges:
- `Parallel Seq Scan on transactions` reads the whole table (about 9,160 buffers, all 501,471 rows).
- 30d: the date filter removes 487,794 rows (`Rows Removed by Filter: 162598` × 3 workers). It keeps 13,677 rows from every tenant, and the hash join with the tenant's 3 accounts then keeps 4,129. Postgres reads about 121 rows for each row it uses.
- The tenant filter can only take effect through the hash join, after the scan. The only `transactions` index that starts with `account_id` is the unique `(account_id, plaid_transaction_id)`, and it can't narrow by date.
- The full scan repeats four times per dashboard load.
- On top of that come four sequential HTTPS round trips at roughly 25–35 ms each.

The bottleneck was both: Postgres scanning far more rows than it needed, and sequential network round trips.

## Changes (one at a time, re-measured after each)

**1. Index `transactions(account_id, transaction_date)`** (`drizzle/0006_summary_account_date_index.sql`)
- Hypothesis: the planner looks up the tenant's accounts first, then range-scans each account's date window, instead of filtering the whole table.
- Result: each query now does a `Nested Loop` over the 3 accounts, with a `Bitmap Index Scan on transactions_account_id_transaction_date_idx` per account. For 30d the index returns exactly the 4,129 needed rows and buffers drop from 9,163 to 766.
- 365d: buffer hits stay about the same (9,163 → 9,180) because a year of this tenant's rows is spread across a third of the pages, and each of the 3 account probes revisits them (`Heap Blocks: exact=9120`). The gain there comes from processing about 50k candidate rows instead of 501k.
- Column order: `account_id` is compared with equality (one probe per owned account), and `transaction_date` with a range. With equality first, each account's matching dates are one contiguous slice of the index. With `transaction_date` first, the scan would walk every tenant's rows in the window and check `account_id` on each. `transactions` has no `user_id` (ownership is derived through `accounts`), so `account_id` is the tenant key here.

**2. `db.batch([...])` for the four queries** (`server/summary.ts`)
- Hypothesis: with the index, the 30d queries take about 12 ms in Postgres, but the wall-clock p50 was still 136.81 ms. Four sequential round trips at about 30 ms each explain most of the gap. One neon-http request instead of four should remove about three round trips.
- Result: Postgres execution time didn't change (as expected, since the SQL is identical), and wall-clock time dropped (table below).

## Results

Postgres execution time (sum of the four per-query medians, ms):

| Range | Baseline | + index | + index + batch (final) | Change |
|---|---|---|---|---|
| 30d | 198.71 | 11.65 | 11.28 | −94.3% |
| 365d | 362.11 | 126.95 | 125.37 | −65.4% |

`getSummary` wall-clock time over neon-http (ms):

| Range | Baseline p50 / p95 | + index p50 / p95 | Final p50 / p95 | p50 change |
|---|---|---|---|---|
| 30d | 323.71 / 356.20 | 136.81 / 196.36 | 46.92 / 67.35 | −85.5% |
| 365d | 306.58 / 370.89 | 245.23 / 336.15 | 136.88 / 161.35 | −55.4% |

Both changes helped, and neither was rolled back. The index fixed the Postgres side, and the batch fixed the network side. The final 30d request is roughly one round trip plus a few milliseconds of query time.

## Considered, intentionally not added

- **Index on `transaction_date` alone:** it would still read every tenant's rows in the window (13,677 for 30d instead of 4,129).
- **Covering index** (`INCLUDE (amount_cents, category_id)`) for index-only scans. It could cut the 365d heap visits, but it's a bigger index to maintain, and 365d is no longer the default view.
- **Merging the four queries into one SQL statement**, for example with `FILTER` clauses. After the index, each query costs 2–4 ms for 30d, so the remaining time is network, which the batch already addressed.
- **`Promise.all`:** four concurrent HTTPS requests instead of one. Not measured. The batch is one request, and its server-side cost (~11 ms, run sequentially) is small.
- **Materialized views, pre-aggregated daily totals, Redis, partitioning, and a denormalized `transactions.user_id`:** too much machinery for a dashboard that now answers in about 47 ms.
- **`CREATE INDEX CONCURRENTLY`:** drizzle's migrator runs inside a transaction, where `CONCURRENTLY` isn't allowed. The tables here are small. On a large production table, I'd build the index concurrently outside the migration so writes aren't blocked.

## Reproduce

```bash
bun run db:migrate:bench
bun run bench:seed
bun run bench:summary <label>
```
