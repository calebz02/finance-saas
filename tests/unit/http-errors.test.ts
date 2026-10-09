import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError, onError, onNotFound } from "@/server/http/errors";

const buildApp = () => {
  const subRouter = new Hono()
    .get("/app-error", () => {
      throw new AppError("CONFLICT", 409, "Bank already connected");
    })
    .get("/http-exception", () => {
      throw new HTTPException(400, { message: "Malformed JSON in request body" });
    })
    .get("/crash", () => {
      throw new Error("connect ECONNREFUSED postgres://user:secret@db/prod");
    });

  const app = new Hono().basePath("/api");
  app.onError(onError);
  app.notFound(onNotFound);
  app.route("/things", subRouter);

  return app;
};

describe("global error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps an AppError thrown in a mounted sub-router to its status and envelope", async () => {
    const res = await buildApp().request("/api/things/app-error");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "CONFLICT", message: "Bank already connected" },
    });
  });

  it("keeps the status and message of a 4xx HTTPException", async () => {
    const res = await buildApp().request("/api/things/http-exception");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "BAD_REQUEST", message: "Malformed JSON in request body" },
    });
  });

  it("returns a generic 500 without leaking the underlying error message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await buildApp().request("/api/things/crash");
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(text).not.toContain("secret");
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("returns the envelope for unknown routes", async () => {
    const res = await buildApp().request("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });
});
