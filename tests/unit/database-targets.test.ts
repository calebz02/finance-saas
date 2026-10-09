import { describe, expect, it } from "vitest";

import { describeDatabaseUrl, isPooledNeonUrl, resolveDatabaseUrl } from "@/scripts/lib/database-targets";

const DEV = "postgresql://owner:pw@ep-dev-123.us-east-2.aws.neon.tech/neondb?sslmode=require";
const TEST = "postgresql://owner:pw@ep-test-456.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("resolveDatabaseUrl", () => {
  it("returns the connection string for the requested target", () => {
    expect(resolveDatabaseUrl("test", { DATABASE_URL: DEV, DATABASE_URL_TEST: TEST })).toBe(TEST);
  });

  it("refuses when the target's variable is missing", () => {
    expect(() => resolveDatabaseUrl("test", { DATABASE_URL: DEV })).toThrow(/DATABASE_URL_TEST is not set/);
  });

  it("refuses when test points at the dev database, even with different query params", () => {
    const sameAsDev = DEV.replace("?sslmode=require", "?sslmode=verify-full");

    expect(() => resolveDatabaseUrl("test", { DATABASE_URL: DEV, DATABASE_URL_TEST: sameAsDev }))
      .toThrow(/point at the same database/);
  });

  it("never includes the password when describing a URL", () => {
    expect(describeDatabaseUrl(DEV)).toBe("ep-dev-123.us-east-2.aws.neon.tech/neondb");
  });
});

describe("isPooledNeonUrl", () => {
  it("detects the Neon -pooler hostname used by PgBouncer", () => {
    expect(isPooledNeonUrl(DEV)).toBe(false);
    expect(isPooledNeonUrl(
      "postgresql://owner:pw@ep-dev-123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    )).toBe(true);
  });
});
