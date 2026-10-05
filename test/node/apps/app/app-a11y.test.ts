// The client app's small accessibility promises: the login's number field takes the app's one focus ring, a
// placeholder can be read on white, and the profile button is named by the initials it shows.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { home } from "../../../../apps/app/src/content.ts";

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, "/");
    if (statSync(path).isDirectory()) return stylesheets(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

/** Each rule of a stylesheet, as its selector and its declarations. */
function rulesOf(path: string): [string, string][] {
  const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => [selector.trim(), body]);
}

describe("the client app", () => {
  it("rings the login's number field as it rings every control: 2 px, in the ground's colour", () => {
    const field = rulesOf("apps/app/src/login/login.module.css").find(
      ([selector]) => selector === ".field:focus-within",
    );
    expect(field?.[1]).toContain("outline: var(--focus-width) solid var(--focus-colour)");
    expect(field?.[1]).not.toContain("--gilt");
  });

  it("writes every placeholder in the hint's colour, which reads at 5:1 on white", () => {
    const placeholders = stylesheets("apps/app/src")
      .flatMap(rulesOf)
      .filter(([selector]) => selector.includes("::placeholder"));
    expect(placeholders.length).toBeGreaterThan(0);
    for (const [, body] of placeholders) expect(body).toContain("color: var(--paper-hint)");
  });

  it("names the profile button by the initials it shows, so saying them reaches it", () => {
    expect(home.profile("RM")).toMatch(/^RM\b/);
  });
});
