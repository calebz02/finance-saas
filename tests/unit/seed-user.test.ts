import { describe, expect, it, vi } from "vitest";

import { buildSeedRows, seedUser } from "@/scripts/lib/seed-user";

describe("buildSeedRows", () => {
  it("tags every generated row with only the given user id", () => {
    const rows = buildSeedRows("user_abc123", new Date("2026-10-02T12:00:00Z"), () => 0.5);

    expect(rows.accounts.every((account) => account.userId === "user_abc123")).toBe(true);
    expect(rows.categories.every((category) => category.userId === "user_abc123")).toBe(true);
    expect(rows.accounts.map((account) => account.name)).toEqual(["Checking", "Savings"]);
    expect(rows.categories.map((category) => category.name)).toEqual([
      "Food",
      "Rent",
      "Utilities",
      "Clothing",
    ]);
  });
});

describe("seedUser", () => {
  it("refuses ids that are not Clerk user ids before touching the database", async () => {
    const db = { batch: vi.fn() };

    await expect(seedUser(db as never, "everyone")).rejects.toThrow(/Refusing to seed/);
    await expect(seedUser(db as never, "user_")).rejects.toThrow(/Refusing to seed/);
    await expect(seedUser(db as never, "")).rejects.toThrow(/Refusing to seed/);
    expect(db.batch).not.toHaveBeenCalled();
  });
});
