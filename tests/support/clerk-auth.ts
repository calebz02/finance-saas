// Stand-in for @hono/clerk-auth in route tests: the user id comes from a header.
// Use with `vi.mock("@hono/clerk-auth", () => import("@/tests/support/clerk-auth"))`.

type TestContext = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  req: { header: (name: string) => string | undefined };
};

export const TEST_USER_HEADER = "x-test-user-id";

export const getAuth = (c: TestContext) => c.get("clerkAuth");

export const clerkMiddleware = () => async (c: TestContext, next: () => Promise<void>) => {
  c.set("clerkAuth", { userId: c.req.header(TEST_USER_HEADER) ?? null });
  await next();
};
