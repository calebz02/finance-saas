import { Hono } from "hono";
import { testClient } from "hono/testing";
import { clerkMiddleware } from "@hono/clerk-auth";
import { describe, expect, it, vi } from "vitest";

import { requireAuth } from "@/server/http/auth";
import { onError } from "@/server/http/errors";

// Stand-in for Clerk's JWT verification: it reads the user id from a header
// instead of a session cookie. Production code has no such bypass.
vi.mock("@hono/clerk-auth", () => ({
  getAuth: (c: { get: (key: string) => unknown }) => c.get("clerkAuth"),
  clerkMiddleware: () => async (
    c: { req: { header: (name: string) => string | undefined }; set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("clerkAuth", { userId: c.req.header("x-test-user-id") ?? null });
    await next();
  },
}));

const handler = vi.fn();

const router = new Hono()
  .use(clerkMiddleware(), requireAuth)
  .get("/me", (c) => {
    handler();
    return c.json({ userId: c.get("userId") });
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildApp = (child: Hono<any, any, any>) => {
  const app = new Hono();
  app.onError(onError);
  return app.route("/", child);
};

describe("requireAuth", () => {
  it("rejects a request without a Clerk session with a 401 envelope before the handler runs", async () => {
    handler.mockClear();

    const res = await buildApp(router).request("/me");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("puts the authenticated user id into the Hono context", async () => {
    const res = await buildApp(router).request("/me", {
      headers: { "x-test-user-id": "user_alice" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user_alice" });
  });

  it("fails closed when clerkMiddleware did not run", async () => {
    const misconfigured = new Hono()
      .use(requireAuth)
      .get("/me", (c) => c.json({ userId: c.get("userId") }));

    const res = await buildApp(misconfigured).request("/me", {
      headers: { "x-test-user-id": "user_alice" },
    });

    expect(res.status).toBe(401);
  });

  it("keeps Hono RPC types when applied with chained .use()", async () => {
    const client = testClient(router);

    const res = await client.me.$get(undefined, {
      headers: { "x-test-user-id": "user_bob" },
    });
    // Compiles only if `userId: string` survived the middleware chain into the client type.
    const body: { userId: string } = await res.json();

    expect(body.userId).toBe("user_bob");
  });
});
