import { config } from "dotenv";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import {
  DATABASE_TARGETS,
  describeDatabaseUrl,
  isDatabaseTarget,
  isPooledNeonUrl,
  resolveDatabaseUrl,
} from "./lib/database-targets";

config({ path: ".env.local" });

/*
 * Uses node-postgres (TCP) rather than neon-http: drizzle's node-postgres
 * migrator applies all pending migrations inside one transaction, while the
 * neon-http migrator runs statements one by one and records them at the end,
 * so a failure there can leave a half-applied, unrecorded migration.
 */
const main = async () => {
  const target = process.argv[2] ?? "dev";

  if (!isDatabaseTarget(target)) {
    throw new Error(`Unknown target "${target}". Use one of: ${Object.keys(DATABASE_TARGETS).join(", ")}`);
  }

  const url = resolveDatabaseUrl(target);

  // Policy, not a hard limit: migrations stay on one dedicated backend so future
  // files can rely on session settings (SET lock_timeout, advisory locks).
  if (isPooledNeonUrl(url)) {
    throw new Error(
      `The ${target} connection string is a Neon pooled URL (hostname contains "-pooler"). Migrations require the direct string; copy it with Connection pooling turned off.`,
    );
  }

  console.log(`Migrating ${target} database (${describeDatabaseUrl(url)})`);

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    console.log("Migrations applied.");
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error("Migration failed. Pending migrations were rolled back:", error);
  process.exit(1);
});
