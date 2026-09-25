// The technician app names every write with a UUIDv7 (apps/tech/src/store/uuidv7.ts),
// which begins with 48 bits of Unix milliseconds: the moment the phone queued it.

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The millisecond a UUIDv7 begins with (RFC 9562, section 5.7); null for any other ID. */
export function timeOfUuidV7(id: string): Date | null {
  if (!UUID_V7.test(id)) return null;
  return new Date(Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16));
}
