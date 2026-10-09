import { Hono } from "hono"
import { handle } from "hono/vercel";

import { onError, onNotFound } from "@/server/http/errors";

import plaid from "./plaid";
import summary from "./summary";
import accounts from "./accounts";
import categories from "./categories";
import transactions from "./transactions";
import subscriptions from "./subscriptions";

export const runtime = "nodejs";

const app = new Hono().basePath("/api");

app.onError(onError);
app.notFound(onNotFound);

const routes = app
  .route("/plaid", plaid)
  .route("/summary", summary)
  .route("/accounts", accounts)
  .route("/categories", categories)
  .route("/transactions", transactions)
  .route("/subscriptions", subscriptions)

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);

export type AppType = typeof routes;
