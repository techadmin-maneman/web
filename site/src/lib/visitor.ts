// The name and number a visitor gave the try-on's gate, and the code that proved the number, kept for this tab only
// (sessionStorage, gone when it closes), so /book starts from them and a booking for that number goes on into the app
// signed in (ADR 0214). Storage a browser refuses keeps nothing, and every page works without it.

import { mobileDigits } from "@maneman/web-kit/mobile";

const KEY = "mm_visitor";

export interface Visitor {
  readonly name: string;
  /** The ten digits. */
  readonly mobile: string;
  /** The code that proved the number (POST /api/number-code/verify): it proves it for 30 minutes. */
  readonly proof: string;
}

export function rememberVisitor(visitor: Visitor): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(visitor));
  } catch {
    // Kept nowhere: the visitor types them again.
  }
}

export function rememberedVisitor(): Visitor | null {
  try {
    const kept: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (typeof kept !== "object" || kept === null) return null;
    const { name, mobile, proof } = kept as Record<string, unknown>;
    if (typeof name !== "string" || typeof mobile !== "string" || typeof proof !== "string") return null;
    if (mobileDigits(mobile) !== mobile) return null;
    return { name, mobile, proof };
  } catch {
    return null;
  }
}

/** The proof kept for these digits; null for another number, or none kept. */
export function proofFor(digits: string): string | null {
  const visitor = rememberedVisitor();
  return visitor !== null && visitor.mobile === digits ? visitor.proof : null;
}
