import "server-only";

/**
 * Fail closed: only the exact string "true" turns a flag on.
 * Read per call, not at import, so the value is the runtime environment's.
 */

/** Plaid is future work (no cursor sync, webhooks, or token encryption yet). */
export const isPlaidEnabled = () => process.env.ENABLE_PLAID === "true";

/** The paywall is off in the portfolio build, so nothing in the UI calls /api/subscriptions. */
export const isSubscriptionsEnabled = () => process.env.ENABLE_SUBSCRIPTIONS === "true";
