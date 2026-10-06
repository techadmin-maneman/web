// Reads the Worker's vars and secrets one at a time for ./settings.ts, noting each problem instead of stopping at
// the first.

import { toE164 } from "../lib/mobile.ts";
import { type FixedLimit, FIXED_LIMITS } from "./limits.ts";

export type Env = Readonly<Record<string, unknown>>;

export class Reader {
  readonly problems: string[] = [];
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  text(name: string): string {
    const value = this.env[name];
    if (typeof value !== "string" || value.trim() === "") {
      this.problems.push(`${name} is not set`);
      return "";
    }
    return value.trim();
  }

  optionalText(name: string): string | null {
    const value = this.env[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  }

  /** "true" or "false"; vars arrive as strings. */
  flag(name: string): boolean {
    const value = this.text(name);
    if (value !== "true" && value !== "false") {
      this.problems.push(`${name} must be "true" or "false"`);
      return false;
    }
    return value === "true";
  }

  /** A whole number from 0 up; vars arrive as strings. */
  count(name: string): number {
    const value = Number(this.text(name));
    if (!Number.isInteger(value) || value < 0) {
      this.problems.push(`${name} must be a whole number`);
      return 0;
    }
    return value;
  }

  /**
   * A limit fixed in ./limits.ts. A var of the same name may raise it on a local run only, as the browser tests do
   * (playwright.config.ts); anywhere else that var is refused.
   */
  fixedLimit(name: FixedLimit, isLocal: boolean): number {
    if (this.optionalText(name) === null) return FIXED_LIMITS[name];
    if (isLocal) return this.count(name);
    this.problems.push(`${name} is fixed in src/config/limits.ts: only a local run may set it`);
    return FIXED_LIMITS[name];
  }

  /** A secret long enough to sign with. */
  key(name: string): string {
    const value = this.text(name);
    if (value !== "" && value.length < 32) this.problems.push(`${name} must be at least 32 characters`);
    return value;
  }

  /** One of `allowed`; the first stands in while a problem is reported. */
  oneOf<T extends string>(name: string, allowed: readonly [T, ...T[]]): T {
    const value = this.text(name);
    const match = allowed.find((option) => option === value);
    if (match !== undefined) return match;
    this.problems.push(`${name} must be one of ${allowed.join(", ")}`);
    return allowed[0];
  }

  /** Comma-separated Indian mobile numbers, as E.164; empty when unset. */
  mobiles(name: string): string[] {
    const entries = (this.optionalText(name) ?? "").split(",").map((entry) => entry.trim());
    const numbers: string[] = [];
    for (const entry of entries.filter((item) => item !== "")) {
      const number = toE164(entry);
      if (number === null) this.problems.push(`${name} has an entry that is not an Indian mobile number`);
      else numbers.push(number);
    }
    return numbers;
  }
}
