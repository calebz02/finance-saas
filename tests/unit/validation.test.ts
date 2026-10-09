import { z } from "zod";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { describe, expect, it } from "vitest";

import { onError } from "@/server/http/errors";
import { idParamSchema, validationHook } from "@/server/http/validation";

const buildApp = () => {
  const app = new Hono()
    .post(
      "/things",
      zValidator("json", z.object({ payee: z.string().min(1, "Payee is required") }), validationHook),
      (c) => c.json({ data: c.req.valid("json") }),
    )
    .get(
      "/things/:id",
      zValidator("param", idParamSchema, validationHook),
      (c) => c.json({ data: c.req.valid("param") }),
    );
  app.onError(onError);
  return app;
};

const post = (body: unknown) =>
  buildApp().request("/things", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("validationHook", () => {
  it("turns a validation failure into the error envelope, naming the field", async () => {
    const res = await post({ payee: "" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "BAD_REQUEST", message: "payee: Payee is required" },
    });
  });

  it("passes valid input through unchanged", async () => {
    const res = await post({ payee: "Coffee" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { payee: "Coffee" } });
  });

  it("accepts a non-empty path id", async () => {
    const res = await buildApp().request("/things/abc");

    expect(await res.json()).toEqual({ data: { id: "abc" } });
  });
});
