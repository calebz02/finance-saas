import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";

import { describeDatabaseUrl, resolveDatabaseUrl } from "../lib/database-targets";
import { HEAVY_USER_ID } from "./guard";

config({ path: ".env.local" });

const RANGES = {
  "30d": { from: "2026-09-01", to: "2026-09-30" },
  "365d": { from: "2025-10-01", to: "2026-09-30" },
} as const;

const EXPLAIN_WARMUPS = 3;
const EXPLAIN_RUNS = 10;
const WALL_WARMUPS = 5;
const WALL_RUNS = 25;

const round = (ms: number) => Math.round(ms * 100) / 100;
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
const median = (values: number[]) => {
  const s = sorted(values);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
// Nearest-rank percentile: with 25 runs, p95 is the 24th fastest.
const percentile = (values: number[], p: number) => sorted(values)[Math.ceil((p / 100) * values.length) - 1];

const time = async (fn: () => Promise<unknown>, warmups: number, runs: number) => {
  for (let i = 0; i < warmups; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  return {
    p50: round(median(samples)),
    p95: round(percentile(samples, 95)),
    min: round(Math.min(...samples)),
    max: round(Math.max(...samples)),
  };
};

/*
 * Usage: bun run bench:summary <label>   (writes docs/benchmarks/<label>/)
 *
 * Postgres execution time comes from EXPLAIN (ANALYZE, BUFFERS) over TCP on the
 * exact SQL getSummary sends. Wall-clock time calls getSummary itself through
 * the production neon-http driver, so it includes every HTTPS round trip.
 */
const main = async () => {
  const label = process.argv[2];
  if (!label || !/^[\w-]+$/.test(label)) {
    throw new Error("Usage: bun run bench:summary <label>");
  }

  const url = resolveDatabaseUrl("bench");
  // db/drizzle.ts reads DATABASE_URL at import time, so set it before importing app code.
  process.env.DATABASE_URL = url;
  const { getSummary, summaryQueries } = await import("@/server/summary");
  const { sql: neonSql } = await import("@/db/drizzle");

  const outDir = `docs/benchmarks/${label}`;
  await mkdir(outDir, { recursive: true });

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const { rows: [environment] } = await client.query(
      `SELECT version() AS postgres,
              current_setting('shared_buffers') AS shared_buffers,
              current_setting('work_mem') AS work_mem,
              current_setting('random_page_cost') AS random_page_cost`,
    );
    const { rows: [dataset] } = await client.query(
      `SELECT
         (SELECT count(*) FROM transactions)::int AS transactions,
         (SELECT count(*) FROM accounts)::int AS accounts,
         (SELECT count(*) FROM categories)::int AS categories,
         (SELECT count(DISTINCT user_id) FROM accounts)::int AS users,
         (SELECT count(*) FROM accounts WHERE user_id = $1)::int AS measured_user_accounts,
         (SELECT count(*) FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = $1)::int AS measured_user_transactions,
         (SELECT min(transaction_date)::text FROM transactions) AS first_date,
         (SELECT max(transaction_date)::text FROM transactions) AS last_date,
         (SELECT string_agg(indexname, ', ' ORDER BY indexname) FROM pg_indexes WHERE tablename = 'transactions') AS transaction_indexes`,
      [HEAVY_USER_ID],
    );

    const results: Record<string, unknown> = {};

    for (const [rangeName, range] of Object.entries(RANGES)) {
      const queries = summaryQueries(HEAVY_USER_ID, range);
      const { rows: [{ rows_in_range }] } = await client.query(
        `SELECT count(*)::int AS rows_in_range FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE a.user_id = $1 AND t.transaction_date BETWEEN $2 AND $3`,
        [HEAVY_USER_ID, range.from, range.to],
      );

      const executionMs: Record<string, number> = {};

      for (const [name, query] of Object.entries(queries)) {
        const { sql: text, params } = query.toSQL();
        const explain = `EXPLAIN (ANALYZE, BUFFERS) ${text}`;
        let plan = "";
        const samples: number[] = [];

        for (let i = 0; i < EXPLAIN_WARMUPS + EXPLAIN_RUNS; i++) {
          const { rows } = await client.query(explain, params);
          plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
          const ms = Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1]);
          if (i >= EXPLAIN_WARMUPS) samples.push(ms);
        }

        executionMs[name] = round(median(samples));
        await writeFile(
          `${outDir}/${rangeName}-${name}.txt`,
          `-- ${label} / ${rangeName} / ${name}: median Execution Time ${executionMs[name]} ms over ${EXPLAIN_RUNS} runs\n` +
          `-- ${text}\n-- params: ${JSON.stringify(params)}\n\n${plan}\n`,
        );
      }

      const summary = await getSummary(HEAVY_USER_ID, range);
      const wallClockMs = await time(() => getSummary(HEAVY_USER_ID, range), WALL_WARMUPS, WALL_RUNS);

      results[rangeName] = {
        range,
        measuredUserRowsInRange: rows_in_range,
        postgresExecutionMsMedian: {
          ...executionMs,
          total: round(Object.values(executionMs).reduce((a, b) => a + b, 0)),
        },
        getSummaryWallClockMs: wallClockMs,
        resultSha256: createHash("sha256").update(JSON.stringify(summary)).digest("hex"),
      };
    }

    const neonHttpSelect1Ms = await time(() => neonSql`SELECT 1`, WALL_WARMUPS, WALL_RUNS);

    const report = {
      label,
      measuredAt: new Date().toISOString(),
      database: describeDatabaseUrl(url),
      environment,
      dataset,
      method: {
        measuredUser: HEAVY_USER_ID,
        explain: `${EXPLAIN_WARMUPS} warm-ups, median of ${EXPLAIN_RUNS} EXPLAIN (ANALYZE, BUFFERS) runs per query (pg over TCP)`,
        wallClock: `${WALL_WARMUPS} warm-ups, ${WALL_RUNS} measured getSummary calls (neon-http, from the developer laptop)`,
      },
      neonHttpSelect1Ms,
      results,
    };

    await writeFile(`${outDir}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
