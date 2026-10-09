import { resolveDatabaseUrl } from "../lib/database-targets";

type Env = Record<string, string | undefined>;

/** Every benchmark tenant id starts with this, so real Clerk users (`user_...`) are recognizable. */
export const BENCH_USER_PREFIX = "bench_";

/** The measured tenant. */
export const HEAVY_USER_ID = `${BENCH_USER_PREFIX}heavy`;

/**
 * The benchmark seed truncates tables, so it refuses unless:
 * 1. DATABASE_URL_BENCH is set and is a different database from dev and test,
 * 2. the open connection is actually that database (not whatever a caller passed), and
 * 3. the database holds no rows for non-benchmark users. Dev and test hold
 *    `user_...` rows, so a bench URL pasted from the wrong branch still fails here.
 */
export function assertBenchTarget(
  connected: { host: string; database: string },
  nonBenchUserRows: number,
  env: Env = process.env,
) {
  const bench = new URL(resolveDatabaseUrl("bench", env));

  if (connected.host !== bench.hostname || connected.database !== bench.pathname.slice(1)) {
    throw new Error(
      `Refusing to reset benchmark data: connected to ${connected.host}/${connected.database}, not DATABASE_URL_BENCH (${bench.hostname}${bench.pathname}).`,
    );
  }

  if (nonBenchUserRows > 0) {
    throw new Error(
      `Refusing to reset benchmark data: found ${nonBenchUserRows} account/category rows whose user_id does not start with "${BENCH_USER_PREFIX}". This does not look like the bench branch.`,
    );
  }
}
