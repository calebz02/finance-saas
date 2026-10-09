import { Hono } from "hono";
import { createId } from "@paralleldrive/cuid2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db/drizzle";
import { bankConnections } from "@/db/schema";
import { onError } from "@/server/http/errors";
import plaidRouter from "@/app/api/[[...route]]/plaid";
import { TEST_USER_HEADER } from "@/tests/support/clerk-auth";

import { truncateAll } from "./helpers";

vi.mock("@hono/clerk-auth", () => import("@/tests/support/clerk-auth"));

const app = new Hono();
app.onError(onError);
app.route("/plaid", plaidRouter);

const USER = "user_day4_plaid";
const ACCESS_TOKEN = "access-sandbox-must-never-leave-the-server";

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { [TEST_USER_HEADER]: USER, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const routes: [string, string, unknown?][] = [
  ["GET", "/plaid/connected-bank"],
  ["DELETE", "/plaid/connected-bank"],
  ["POST", "/plaid/create-link-token"],
  ["POST", "/plaid/exchange-public-token", { publicToken: "public-sandbox-x" }],
];

const originalFlag = process.env.ENABLE_PLAID;

beforeEach(async () => {
  await truncateAll();
  await db.insert(bankConnections).values({
    id: createId(),
    userId: USER,
    plaidItemId: "item-1",
    accessToken: ACCESS_TOKEN,
    institutionName: "Sandbox Bank",
  });
});

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.ENABLE_PLAID;
  } else {
    process.env.ENABLE_PLAID = originalFlag;
  }
});

describe("ENABLE_PLAID", () => {
  it("is off when unset or set to anything but \"true\": every Plaid route is a 404 and nothing is deleted", async () => {
    for (const value of [undefined, "", "1", "TRUE", "yes"]) {
      if (value === undefined) delete process.env.ENABLE_PLAID;
      else process.env.ENABLE_PLAID = value;

      for (const [method, path, body] of routes) {
        const res = await send(method, path, body);
        expect(res.status, `${value} ${method} ${path}`).toBe(404);
        expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
      }
    }

    expect(await db.select({ id: bankConnections.id }).from(bankConnections)).toHaveLength(1);
  });

  it("when on, GET /connected-bank still never returns the access token", async () => {
    process.env.ENABLE_PLAID = "true";

    const res = await send("GET", "/plaid/connected-bank");
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(Object.keys(JSON.parse(text).data).sort()).toEqual(["id", "institutionName", "lastSyncedAt"]);
  });
});
