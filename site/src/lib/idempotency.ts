// One idempotency key per thing a visitor sends. Pressing again after the answer was lost on the way (a phone
// dropping to no signal) sends the same key, so the API can answer the first request again rather than act twice;
// changing anything in the request makes it a new one, with a new key.

export function keyPerRequest(): (request: unknown) => string {
  let last: { request: string; key: string } | null = null;
  return (request) => {
    const written = JSON.stringify(request);
    if (last?.request !== written) last = { request: written, key: crypto.randomUUID() };
    return last.key;
  };
}
