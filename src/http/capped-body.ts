// A request's body, read no further than the most its route takes. Content-Length is only what the sender says: a
// body sent without one, or longer than it said, is counted as it arrives and dropped once it passes the cap, so no
// upload can fill the Worker's 128 MB of memory.

/** The body's bytes; null when it is longer than `maxBytes`, as declared or as it arrives. */
export async function cappedBody(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get("Content-Length") ?? "0") > maxBytes) return null;
  if (request.body === null) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let length = 0;
  // A request body is bytes, however the runtime types it.
  const reader = (request.body as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
