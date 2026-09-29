// How the ops specs answer the console's calls in the browser. Each call is named
// by its method and path, "GET /api/grievances", and each reply is held to
// docs/openapi-ops.json as it is sent (e2e/contract.ts), so a spec cannot answer
// a route mm-api does not have or a body it would never send. Anything a spec
// does not answer goes to the local mm-api.

import type { Page, Route } from "@playwright/test";
import type { paths } from "../../apps/ops/src/api-schema.ts";
import { assertInContract, documentedPath, type Reply } from "../contract.ts";

/** What `method path` answers with `status`, as the console's generated types have it. */
export type OpsReply<
  Path extends keyof paths,
  Method extends keyof paths[Path] = "get",
  Status extends number = 200,
> = Reply<paths, Path, Method, Status>;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * A call the console makes: its method, then its path, whole or with a documented placeholder standing for any one
 * segment, "POST /api/grievances/{id}/resolve".
 */
export type Call = `${Method} /api/${string}`;

export type Answer = (route: Route) => Promise<void>;

/** What a spec answers, call by call. */
export type Answers = Readonly<Partial<Record<Call, Answer>>>;

function sent(route: Route): { method: string; pathname: string } {
  const request = route.request();
  return { method: request.method(), pathname: new URL(request.url()).pathname };
}

export const json =
  (body: unknown, status = 200): Answer =>
  (route) => {
    const { method, pathname } = sent(route);
    assertInContract("ops", method, pathname, status, body);
    return route.fulfill({ status, json: body });
  };

/** A reply with no body, as a 204 is. */
export const empty =
  (status = 204): Answer =>
  (route) => {
    const { method, pathname } = sent(route);
    assertInContract("ops", method, pathname, status);
    return route.fulfill({ status });
  };

export const jpeg =
  (body: Buffer): Answer =>
  (route) => {
    const { method, pathname } = sent(route);
    assertInContract("ops", method, pathname, 200);
    return route.fulfill({ body, contentType: "image/jpeg" });
  };

/** The API's refusal: its code, and for invalid_request the fields it names (src/http/errors.ts). */
export const fails = (status: number, code: string, fields?: readonly string[]): Answer =>
  json({ error: { code, request_id: "test", ...(fields === undefined ? {} : { fields }) } }, status);

interface Answering {
  readonly method: string;
  readonly path: RegExp;
  readonly placeholders: number;
  readonly reply: Answer;
}

/** A call's path as a pattern: a `{placeholder}` segment stands for any one segment. */
function pathPattern(path: string): RegExp {
  const segments = path.split("/").map((segment) => (/^\{.+\}$/.test(segment) ? "[^/]+" : segment));
  return new RegExp(`^${segments.join("/")}$`);
}

function answering(call: string, reply: Answer): Answering {
  const [method = "", path = ""] = call.split(" ");
  if (documentedPath("ops", method, path) === null) {
    throw new Error(`${call} is not a route in docs/openapi-ops.json, so nothing here may answer it`);
  }
  return { method, path: pathPattern(path), placeholders: path.split("{").length, reply };
}

/** Answers the console's calls from `answers`, by method and path; anything else goes to the local mm-api. */
export async function answer(page: Page, answers: Answers): Promise<void> {
  const table = Object.entries(answers)
    .flatMap(([call, reply]) => (reply === undefined ? [] : [answering(call, reply)]))
    .sort((a, b) => a.placeholders - b.placeholders);
  await page.route("**/api/**", (route) => {
    const { method, pathname } = sent(route);
    const match = table.find((entry) => entry.method === method && entry.path.test(pathname));
    return match === undefined ? route.continue() : match.reply(route);
  });
}
