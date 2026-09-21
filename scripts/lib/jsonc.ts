import { readFileSync } from "node:fs";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { JsonObject } from "./wrangler-config-check.ts";

export function readJsonc(path: string): JsonObject {
  const errors: ParseError[] = [];
  const value: unknown = parse(readFileSync(path, "utf8"), errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const details = errors.map((e) => `${printParseErrorCode(e.error)} at offset ${String(e.offset)}`).join(", ");
    throw new Error(`${path}: invalid JSONC (${details})`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected a JSON object`);
  }
  return value as JsonObject;
}
