import { describe, expect, it } from "vitest";

import { assertBenchTarget } from "@/scripts/bench/guard";

const env = {
  DATABASE_URL: "postgresql://owner:pw@ep-dev-123.us-east-2.aws.neon.tech/neondb",
  DATABASE_URL_TEST: "postgresql://owner:pw@ep-test-456.us-east-2.aws.neon.tech/neondb",
  DATABASE_URL_BENCH: "postgresql://owner:pw@ep-bench-789.us-east-2.aws.neon.tech/neondb",
};

const bench = { host: "ep-bench-789.us-east-2.aws.neon.tech", database: "neondb" };

describe("assertBenchTarget", () => {
  it("allows the bench branch when it only holds benchmark tenants", () => {
    expect(() => assertBenchTarget(bench, 0, env)).not.toThrow();
  });

  it("refuses a connection to any other database, such as dev", () => {
    expect(() => assertBenchTarget({ ...bench, host: "ep-dev-123.us-east-2.aws.neon.tech" }, 0, env))
      .toThrow(/not DATABASE_URL_BENCH/);
  });

  it("refuses when DATABASE_URL_BENCH is the dev database", () => {
    expect(() => assertBenchTarget(bench, 0, { ...env, DATABASE_URL: env.DATABASE_URL_BENCH }))
      .toThrow(/point at the same database/);
  });

  it("refuses when real (non-bench) users have rows", () => {
    expect(() => assertBenchTarget(bench, 3, env)).toThrow(/does not look like the bench branch/);
  });
});
