import { describe, expect, it } from "vitest";
import { validUsername } from "../src/shared/username";
describe("username policy", () => {
  it.each(["player", "Player_1", "a".repeat(20)])("accepts %s", (value) =>
    expect(validUsername(value)).toBe(true),
  );
  it.each([
    "ab",
    "a".repeat(21),
    "with space",
    "name.dot",
    "name-dash",
    "éclair",
    "ADMIN",
    "support",
    "<script>",
  ])("rejects %s", (value) => expect(validUsername(value)).toBe(false));
});
