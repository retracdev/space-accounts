import { expect, it, vi } from "vitest";
import { gameOrigins } from "../src/server/games";
import type { Env } from "../src/server/auth";

const parse = (GAME_AUTH_ORIGINS?: string) => gameOrigins({ GAME_AUTH_ORIGINS } as Env);
vi.spyOn(console, "warn").mockImplementation(() => {});

it("trusts no game when unset or empty", () => {
  expect(parse(undefined)).toEqual([]);
  expect(parse("")).toEqual([]);
  expect(parse(" ,\n ")).toEqual([]);
});

it("accepts exact origins separated by commas, spaces or newlines", () => {
  const games = ["https://soundboard.retrac.space", "https://glowstudio.retrac.space", "https://toptext.retrac.space"];
  expect(parse(games.join(","))).toEqual(games);
  expect(parse(games.join(", ") + ", ")).toEqual(games);
  expect(parse(games.join("\n") + "\n")).toEqual(games);
  expect(parse(" " + games.join(" ") + " ")).toEqual(games);
  // A trailing slash is the same origin; browsers never send it in Origin.
  expect(parse("https://toptext.retrac.space/")).toEqual(["https://toptext.retrac.space"]);
});

it("ignores invalid entries without disabling valid games (previously threw, causing 503)", () => {
  const invalid = [
    "https://retrac.space", "http://soundboard.retrac.space", "https://evil.test",
    "https://retrac.space.evil.test", "https://x.retrac.space@evil.test",
    "https://toptext.retrac.space/path", "https://toptext.retrac.space?x", "https://toptext.retrac.space//",
    "https://Toptext.retrac.space", "https://toptext.retrac.space:443",
    '"https://toptext.retrac.space"', "toptext.retrac.space", "not a url",
  ];
  for (const value of invalid) {
    expect(parse(value)).toEqual([]);
    expect(parse(`https://soundboard.retrac.space,${value},https://glowstudio.retrac.space`))
      .toEqual(["https://soundboard.retrac.space", "https://glowstudio.retrac.space"]);
  }
});
