// A component test's fake of the API, held to the contract as the browser tests' fakes are (e2e/contract.ts): every
// reply it gives is checked against the surface's OpenAPI document, and a call it gives no reply to, which a fake
// written by hand would answer with whatever came last, fails the test. Wrap the fake where it is stubbed:
//
//   vi.stubGlobal("fetch", contractChecked("ops", (url, init) => ...));

import { onTestFinished } from "vitest";
import { contractErrors, type Surface } from "../../e2e/contract.ts";

/** As a test writes it: its init read as the call it fakes sends it, a JSON body or none (a method, so either fits). */
interface FakeOf {
  fake(url: string, init: RequestInit): Promise<Response> | Response | undefined;
}
type Fake = FakeOf["fake"];

/**
 * The fake, its every reply checked; the test fails once it ends, naming each reply the API could not have given. A
 * test of two apps' screens names each call's surface by its path.
 */
export function contractChecked(
  surface: Surface | ((pathname: string) => Surface),
  fake: Fake,
): (url: string, init?: RequestInit) => Promise<Response> {
  const problems: string[] = [];
  onTestFinished(() => {
    if (problems.length > 0) throw new Error(`the fake answered what the API never would:\n${problems.join("\n")}`);
  });
  return async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const { pathname } = new URL(url, "https://fake.maneman.test");
    const reply = await fake(url, init ?? {});
    if (reply === undefined) {
      problems.push(`${method} ${pathname}: no reply was given for it`);
      return Response.json({ error: { code: "not_found", message: "no fake" } }, { status: 404 });
    }
    const json = reply.headers.get("Content-Type")?.includes("json") === true;
    const body: unknown = json ? ((await reply.clone().json()) as unknown) : undefined;
    const of = typeof surface === "function" ? surface(pathname) : surface;
    problems.push(...contractErrors(of, method, pathname, reply.status, body));
    return reply;
  };
}
