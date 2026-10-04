// Reading a vendor's answer by a zod schema. An answer the schema does not fit fails as an UnexpectedAnswer that
// names the step, the first place the answer differs and the keys found there, e.g. "Zoho 200 UNEXPECTED_ANSWER:
// attach_file: data.0.id: Invalid input: expected string, received undefined; data.0 has keys code, details,
// message, status". Field names only, never values: an answer can hold a client's details.

import type { z } from "zod";
import { ProviderError } from "./provider-error.ts";

/** What a vendor answered one step: the status, and the body as JSON, null for an empty 204. */
export interface VendorAnswer {
  /** The vendor as its errors name it: "Zoho", "Razorpay". */
  readonly vendor: string;
  readonly step: string;
  readonly status: number;
  readonly body: unknown;
}

/** An answer that is not what the code reads. Not a refusal: the vendor may well have done what was asked. */
export class UnexpectedAnswer extends ProviderError {
  override readonly name = "UnexpectedAnswer";

  constructor(answer: Omit<VendorAnswer, "body">, what: string) {
    const { vendor, status, step } = answer;
    super(status, "UNEXPECTED_ANSWER", `${vendor} ${String(status)} UNEXPECTED_ANSWER: ${step}: ${what}`, false);
  }
}

/** A successful call's answer as JSON. One that is not JSON fails as an unexpected answer naming the step. */
export async function vendorAnswerOf(vendor: string, step: string, response: Response): Promise<VendorAnswer> {
  const answered = { vendor, step, status: response.status };
  if (response.status === 204) return { ...answered, body: null };
  try {
    return { ...answered, body: await response.json() };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new UnexpectedAnswer(answered, "the answer is not JSON");
  }
}

/** The value under `at` in an answer, read by `schema`; one the schema does not fit throws an UnexpectedAnswer. */
export function parseAnswer<T extends z.ZodType>(
  schema: T,
  answer: VendorAnswer,
  at: readonly PropertyKey[] = [],
): z.infer<T> {
  const parsed = schema.safeParse(valueAt(answer.body, at));
  if (parsed.success) return parsed.data;
  const issue = firstIssue(parsed.error.issues, at);
  throw new UnexpectedAnswer(answer, describeIssue(answer.body, issue));
}

interface AnswerIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** The first issue, with its path from the top of the answer. In a union, the first issue of the first shape tried. */
function firstIssue(issues: z.ZodError["issues"], under: readonly PropertyKey[]): AnswerIssue {
  const [issue] = issues;
  if (issue === undefined) return { path: under, message: "Invalid input" };
  const path = [...under, ...issue.path];
  const firstShape = issue.code === "invalid_union" ? issue.errors[0] : undefined;
  if (firstShape !== undefined && firstShape.length > 0) return firstIssue(firstShape, path);
  return { path, message: issue.message };
}

/** At most this many of an object's keys are named, so the line stays short enough to keep whole. */
const KEYS_NAMED = 10;

function describeIssue(body: unknown, issue: AnswerIssue): string {
  if (issue.path.length === 0) return `the answer: ${issue.message}`;
  const around = issue.path.slice(0, -1);
  const aroundName = around.length === 0 ? "the answer" : pathName(around);
  return `${pathName(issue.path)}: ${issue.message}; ${aroundName} has ${shapeOf(valueAt(body, around))}`;
}

/** ["data", 0, "id"] -> "data.0.id" */
const pathName = (path: readonly PropertyKey[]): string => path.map(String).join(".");

/** What a value is, by its keys or its length, never its contents. */
export function shapeOf(value: unknown): string {
  if (Array.isArray(value)) return `a list of ${String(value.length)}`;
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  const keys = Object.keys(value);
  if (keys.length === 0) return "no keys";
  const more = keys.length > KEYS_NAMED ? ", …" : "";
  return `keys ${keys.slice(0, KEYS_NAMED).join(", ")}${more}`;
}

/** The value at `path` inside `value`; undefined where the path leaves objects and lists. */
function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let found = value;
  for (const key of path) {
    if (typeof found !== "object" || found === null) return undefined;
    found = (found as Record<PropertyKey, unknown>)[key];
  }
  return found;
}
