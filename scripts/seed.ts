import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

import { resolveDatabaseUrl } from "./lib/database-targets";
import { seedUser } from "./lib/seed-user";

config({ path: ".env.local" });

const main = async () => {
  const userId = process.env.SEED_USER_ID;

  if (!userId) {
    console.error("SEED_USER_ID is not set. Use your own Clerk user id from the Clerk dashboard.");
    process.exit(1);
  }

  try {
    const databaseUrl = resolveDatabaseUrl("dev");
    const db = drizzle(neon(databaseUrl));
    const counts = await seedUser(db, userId);
    console.log(`Seeded ${userId}:`, counts);
  } catch (error) {
    console.error("Error during seed:", error);
    process.exit(1);
  }
};

main();
