import { describe, expect, it } from "vitest";
import {
  APP_NAME_MAX,
  guidedAppName,
  guidedImageUrl,
  guidedReturnUrl,
  guidedSetup,
} from "../src/shared/guided-setup";

describe("guided setup return URL", () => {
  it.each([
    "https://retrac.space",
    "https://chess.retrac.space/play?room=4#lobby",
    "https://a.b.retrac.space/",
    "http://localhost:5173/game",
    "http://127.0.0.1:8080/",
  ])("accepts %s", (value) => expect(guidedReturnUrl(value)?.href).toBe(new URL(value).href));

  it.each([
    null,
    "",
    "/settings",
    "//evil.test",
    "https://evil.test",
    "https://retrac.space.evil.test",
    "https://evilretrac.space",
    "https://chess.retrac.space@evil.test",
    "https://user:pass@chess.retrac.space",
    "https://chess.retrac.space:8443",
    "http://chess.retrac.space",
    "http://localhost.evil.test",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://chess.retrac.space/" + "a".repeat(2100),
    "not a url",
  ])("rejects %s", (value) => expect(guidedReturnUrl(value)).toBeNull());
});

describe("guided setup image", () => {
  it("accepts https images on retrac.space", () => {
    expect(guidedImageUrl("https://chess.retrac.space/art.webp")?.href).toBe(
      "https://chess.retrac.space/art.webp",
    );
  });
  it.each([
    "http://chess.retrac.space/art.png",
    "http://localhost:5173/art.png",
    "https://evil.test/art.png",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
  ])("rejects %s", (value) => expect(guidedImageUrl(value)).toBeNull());
});

describe("guided setup app name", () => {
  const back = new URL("https://chess.retrac.space/");
  it("cleans whitespace and invisible characters", () => {
    expect(guidedAppName("  Super\n\tChess‮ ", null)).toBe("Super Chess");
  });
  it("truncates long names", () => {
    const name = guidedAppName("x".repeat(100), null);
    expect([...name].length).toBe(APP_NAME_MAX);
    expect(name.endsWith("…")).toBe(true);
  });
  it("falls back to the return host, then retrac.space", () => {
    expect(guidedAppName(null, back)).toBe("chess.retrac.space");
    expect(guidedAppName("   ", null)).toBe("retrac.space");
  });
});

it("parses the full query string", () => {
  const setup = guidedSetup(
    "?app=Chess&redirect=https%3A%2F%2Fchess.retrac.space%2Fplay&image=https%3A%2F%2Fevil.test%2Fx.png&step=done",
  );
  expect(setup.app).toBe("Chess");
  expect(setup.returnUrl?.href).toBe("https://chess.retrac.space/play");
  expect(setup.image).toBeNull();
  expect(setup.done).toBe(true);
});
