import { describe, expect, it } from "vitest";

import { readErrorMessage } from "@/lib/api-error";

const FALLBACK = "Failed to create transaction";

const respond = (body: string, status: number) => new Response(body, { status });

describe("readErrorMessage", () => {
  it("returns the server's message from the error envelope", async () => {
    const res = respond(JSON.stringify({ error: { code: "UNPROCESSABLE", message: "Invalid accountId" } }), 422);

    expect(await readErrorMessage(res, FALLBACK)).toBe("Invalid accountId");
  });

  it("falls back when the body is not JSON", async () => {
    expect(await readErrorMessage(respond("<html>Bad Gateway</html>", 502), FALLBACK)).toBe(FALLBACK);
    expect(await readErrorMessage(respond("", 500), FALLBACK)).toBe(FALLBACK);
  });

  it("falls back when the JSON is not the envelope", async () => {
    for (const body of [
      { error: "Unauthorized" },
      { error: { message: "" } },
      { error: { message: 42 } },
      { success: false, error: { issues: [], name: "ZodError" } },
      null,
    ]) {
      expect(await readErrorMessage(respond(JSON.stringify(body), 400), FALLBACK)).toBe(FALLBACK);
    }
  });
});
