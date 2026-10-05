// The static server the browser tests and the fidelity harness share (scripts/lib/static-server.ts). Several agents'
// runs use one machine's ports, so a request it cannot read must be refused, not bring it down.

import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { headersFor, parseHeaders, serveDirectory } from "../../../scripts/lib/static-server.ts";

describe("the _headers file", () => {
  it("reads every * in a path pattern as anything, as Cloudflare does", () => {
    const rules = parseHeaders("/images/*/cards/*\n  Cache-Control: no-store\n");
    expect(headersFor(rules, "/images/2026/cards/house.jpg")).toEqual({ "cache-control": "no-store" });
    expect(headersFor(rules, "/images/2026/other/house.jpg")).toEqual({});
  });
});

describe("the server", () => {
  let origin = "";
  let close: () => void = () => undefined;

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), "mm-static-"));
    writeFileSync(join(root, "index.html"), "<p>home</p>");
    writeFileSync(join(root, "404.html"), "<p>missing</p>");
    const server = await serveDirectory(root, 0);
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    close = () => server.close();
  });
  afterAll(() => {
    close();
  });

  it("answers 400 to a path it cannot decode, and goes on serving", async () => {
    expect((await fetch(`${origin}/%E0%A4%A`)).status).toBe(400);
    const home = await fetch(`${origin}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toBe("<p>home</p>");
  });
});
