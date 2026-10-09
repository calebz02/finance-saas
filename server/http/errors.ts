import "server-only";

import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { StatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "INTERNAL_ERROR";

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
  };
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: StatusCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () =>
  new AppError("UNAUTHORIZED", 401, "Authentication required");

export const badRequest = (message: string) =>
  new AppError("BAD_REQUEST", 400, message);

/** A path ID the caller does not own looks exactly like one that does not exist. */
export const notFound = () =>
  new AppError("NOT_FOUND", 404, "Not found");

/** A body ID the caller does not own looks exactly like one that does not exist. */
export const invalidReference = (field: "accountId" | "categoryId") =>
  new AppError("UNPROCESSABLE", 422, `Invalid ${field}`);

export const errorBody = (code: ErrorCode, message: string): ErrorBody => ({
  error: { code, message },
});

const codeForStatus = (status: number): ErrorCode => {
  switch (status) {
    case 400: return "BAD_REQUEST";
    case 401: return "UNAUTHORIZED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 409: return "CONFLICT";
    case 422: return "UNPROCESSABLE";
    default: return status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
  }
};

export const onError: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(errorBody(err.code, err.message), err.status);
  }

  if (err instanceof HTTPException && err.status < 500) {
    return c.json(
      errorBody(codeForStatus(err.status), err.message || "Request failed"),
      err.status,
    );
  }

  // Never echo unexpected error messages: they can contain SQL, tokens, or stack details.
  console.error(err);
  return c.json(errorBody("INTERNAL_ERROR", "Internal server error"), 500);
};

export const onNotFound: NotFoundHandler = (c) =>
  c.json(errorBody("NOT_FOUND", "Route not found"), 404);
