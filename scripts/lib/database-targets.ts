export const DATABASE_TARGETS = {
  dev: "DATABASE_URL",
  test: "DATABASE_URL_TEST",
  bench: "DATABASE_URL_BENCH",
} as const;

export type DatabaseTarget = keyof typeof DATABASE_TARGETS;

type Env = Record<string, string | undefined>;

export const isDatabaseTarget = (value: string): value is DatabaseTarget =>
  Object.hasOwn(DATABASE_TARGETS, value);

const databaseIdentity = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
};

/** Host and database name only, so logs never contain the password. */
export const describeDatabaseUrl = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.pathname}`;
};

/**
 * Neon pooled hosts look like `ep-xxx-pooler.region.aws.neon.tech` (PgBouncer,
 * transaction mode). Transactions run fine there, but session state (SET,
 * session advisory locks, temp tables, LISTEN) does not survive between them.
 */
export const isPooledNeonUrl = (url: string) => {
  try {
    return new URL(url).hostname.includes("-pooler.");
  } catch {
    return false;
  }
};

/**
 * Returns the connection string for `target`, refusing when it is missing or
 * when it points at the same database as another target. The test suite
 * truncates tables, so sharing a database with dev must be impossible.
 */
export function resolveDatabaseUrl(target: DatabaseTarget, env: Env = process.env) {
  const variable = DATABASE_TARGETS[target];
  const url = env[variable];

  if (!url) {
    throw new Error(
      `${variable} is not set. Create the Neon "${target}" branch in the console, copy its connection string, and add it to .env.local.`,
    );
  }

  for (const [otherTarget, otherVariable] of Object.entries(DATABASE_TARGETS)) {
    const otherUrl = env[otherVariable];

    if (otherTarget !== target && otherUrl && databaseIdentity(otherUrl) === databaseIdentity(url)) {
      throw new Error(`${variable} and ${otherVariable} point at the same database. Each target needs its own Neon branch.`);
    }
  }

  return url;
}
