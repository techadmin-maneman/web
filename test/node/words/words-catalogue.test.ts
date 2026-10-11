// The list of every line the Words page may change (./catalogue.ts) is src/config/words.json, which the API reads;
// it fails here until `npm run words` writes it again after the copy changes.

import { describe, expect, it } from "vitest";
import { wordsCatalogue } from "./catalogue.ts";

describe("the Words page's lines", () => {
  const lines = wordsCatalogue();

  it("are src/config/words.json as it stands", async () => {
    await expect(`${JSON.stringify(lines, null, 2)}\n`).toMatchFileSnapshot("../../../src/config/words.json");
  });

  it("each have a key of their own", () => {
    expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
  });

  it("leave out the legal pages, the consent notices, the login code and anything that is not copy", () => {
    const keys = lines.map((line) => line.key);
    expect(keys.some((key) => key.startsWith("site:legal") || key.startsWith("site:notices"))).toBe(false);
    expect(keys).not.toContain("message:login_code_v1");
    expect(lines.some((line) => /^[/#]|\.(?:jpe?g|png|webp)$/.test(line.text))).toBe(false);
    expect(lines.some((line) => /^\{[a-zA-Z]+\}$/.test(line.text))).toBe(false);
  });

  it("hold the site's copy and every message to a client", () => {
    expect(lines.filter((line) => line.surface === "site").length).toBeGreaterThan(400);
    expect(lines.filter((line) => line.surface === "message").length).toBeGreaterThan(40);
  });
});
