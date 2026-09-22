import { describe, expect, it } from "vitest";
import { deviceLabel } from "../../src/domain/sessions.ts";

describe("deviceLabel", () => {
  it.each([
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari on iOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0",
      "Edge on Windows",
    ],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:130.0) Gecko/20100101 Firefox/130.0", "Firefox on macOS"],
    ["curl/8.9", null],
    [undefined, null],
  ])("names %s as %s", (userAgent, label) => {
    expect(deviceLabel(userAgent)).toBe(label);
  });
});
