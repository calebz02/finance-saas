import { config } from "dotenv";

import { resolveDatabaseUrl } from "@/scripts/lib/database-targets";

// Loaded explicitly so it does not depend on Bun's or Vite's NODE_ENV-based .env rules
// (Vitest sets NODE_ENV=test, under which Bun would skip .env.local).
config({ path: ".env.local" });

// Throws (failing the whole run) unless DATABASE_URL_TEST is set and differs from dev and bench.
// db/drizzle.ts reads DATABASE_URL at import time, so app code under test talks to the test branch.
process.env.DATABASE_URL = resolveDatabaseUrl("test");
