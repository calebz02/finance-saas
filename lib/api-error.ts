/**
 * Reads the `{ error: { message } }` envelope from a failed API response.
 * Falls back when the body is not JSON or not the envelope (a proxy error
 * page, a crashed function, an older route).
 */
export async function readErrorMessage(
  response: { json(): Promise<unknown> },
  fallback: string,
): Promise<string> {
  try {
    const body = await response.json();

    if (typeof body === "object" && body !== null && "error" in body) {
      const { error } = body as { error: unknown };

      if (typeof error === "object" && error !== null && "message" in error) {
        const { message } = error as { message: unknown };

        if (typeof message === "string" && message.trim() !== "") {
          return message;
        }
      }
    }
  } catch {
    // Not JSON.
  }

  return fallback;
}
