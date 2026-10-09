import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db/drizzle";
import { subscriptions } from "@/db/schema";
import { onError } from "@/server/http/errors";
import subscriptionsRouter from "@/app/api/[[...route]]/subscriptions";
import { TEST_USER_HEADER } from "@/tests/support/clerk-auth";

import { truncateAll } from "./helpers";

vi.mock("@hono/clerk-auth", () => import("@/tests/support/clerk-auth"));

const app = new Hono();
app.onError(onError);
app.route("/subscriptions", subscriptionsRouter);

const USER = "user_day6_subscriptions";

const webhookPayload = {
  meta: { event_name: "subscription_created", custom_data: { user_id: USER } },
  data: { id: "sub_1", attributes: { status: "active" } },
};

const routes: [string, string, unknown?][] = [
  ["GET", "/subscriptions/current"],
  ["POST", "/subscriptions/checkout"],
  ["POST", "/subscriptions/webhook", webhookPayload],
];

const originalFlag = process.env.ENABLE_SUBSCRIPTIONS;

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.ENABLE_SUBSCRIPTIONS;
  } else {
    process.env.ENABLE_SUBSCRIPTIONS = originalFlag;
  }
});

describe("ENABLE_SUBSCRIPTIONS", () => {
  it("is off when unset or set to anything but \"true\": every subscription route is a 404 and nothing is written", async () => {
    for (const value of [undefined, "", "1", "TRUE", "yes"]) {
      if (value === undefined) delete process.env.ENABLE_SUBSCRIPTIONS;
      else process.env.ENABLE_SUBSCRIPTIONS = value;

      for (const [method, path, body] of routes) {
        const res = await app.request(path, {
          method,
          headers: {
            [TEST_USER_HEADER]: USER,
            "content-type": "application/json",
            "x-signature": "forged",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

        expect(res.status, `${value} ${method} ${path}`).toBe(404);
        expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
      }
    }

    expect(await db.select({ id: subscriptions.id }).from(subscriptions)).toHaveLength(0);
  });
});
