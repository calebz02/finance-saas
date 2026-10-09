import { sql } from "drizzle-orm";

import { db } from "@/db/drizzle";

// Bun's own runner (`bun test`) skips tests/db/setup.ts, so DATABASE_URL could still be dev here.
export const truncateAll = () => {
  const testUrl = process.env.DATABASE_URL_TEST;

  if (!testUrl || process.env.DATABASE_URL !== testUrl) {
    throw new Error("Refusing to truncate: DATABASE_URL is not the test branch. Run `bun run test:db`, not `bun test`.");
  }

  return db.execute(sql`
    TRUNCATE transactions, accounts, categories, bank_connections, subscriptions
  `);
};
