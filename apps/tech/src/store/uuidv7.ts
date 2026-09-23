// The client-generated event ID every technician write carries
// (docs/prompts/phase2-backend.md: "Every write accepts the client-generated
// `X-Client-Event-Id`, which is idempotent").
//
// A UUIDv7 (RFC 9562, section 5.7): 48 bits of Unix milliseconds first, then
// randomness. Two events queued in different milliseconds therefore sort in the
// order they happened, which is what makes a replayed queue readable. Order
// within one millisecond is not guaranteed, so the outbox keeps its own key and
// never sorts by this (apps/tech/src/store/outbox.ts).

const hex = (byte: number) => byte.toString(16).padStart(2, "0");

export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48 bits of milliseconds, most significant byte first.
  let time = Math.floor(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  // Version 7 in the high nibble of byte 6, variant 10 in the top bits of byte 8.
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const digits = Array.from(bytes, hex).join("");
  return [digits.slice(0, 8), digits.slice(8, 12), digits.slice(12, 16), digits.slice(16, 20), digits.slice(20)].join(
    "-",
  );
}

/** The millisecond a UUIDv7 carries, for "queued at 9:41" without a second field. */
export function queuedAt(id: string): number {
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
