// Part of a file, as a Range header asks for it (RFC 9110, section 14). The site's assets give only whole files,
// and iOS Safari plays a video only from a server that gives parts. The part is passed on as the file arrives, so a
// Worker never holds a whole film.

/** One run of bytes, both ends included. */
interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** "bytes=0-1023", "bytes=1000-" or "bytes=-500": one range. A list of several is answered with the whole file. */
const ONE_RANGE = /^bytes=(\d*)-(\d*)$/;

/** The last `length` bytes of a file of `size` bytes. */
function lastBytes(length: number, size: number): ByteRange | "unsatisfiable" {
  if (length === 0) return "unsatisfiable";
  return { start: Math.max(size - length, 0), end: size - 1 };
}

/**
 * The range a Range header asks for in a file of `size` bytes: "whole" for a header to ignore, as the RFC allows,
 * and "unsatisfiable" for one that starts past the end.
 */
export function rangeOf(header: string | null, size: number): ByteRange | "whole" | "unsatisfiable" {
  if (header === null) return "whole";
  const match = ONE_RANGE.exec(header.trim());
  if (match === null) return "whole";
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return "whole";
  if (size === 0) return "unsatisfiable";
  if (first === "") return lastBytes(Number(last), size);
  const start = Number(first);
  if (start >= size) return "unsatisfiable";
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (end < start) return "whole";
  return { start, end };
}

/** The bytes of `body` from the range's start to its end, passed on as each chunk arrives; the rest is let go. */
function slice(body: ReadableStream, range: ByteRange): ReadableStream<Uint8Array> {
  let at = 0;
  const cut = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const from = Math.max(range.start - at, 0);
      const to = Math.min(range.end + 1 - at, chunk.byteLength);
      at += chunk.byteLength;
      if (from < to) controller.enqueue(chunk.subarray(from, to));
      if (at > range.end) controller.terminate();
    },
  });
  return body.pipeThrough(cut);
}

/** The file's size, from the assets' Content-Length; null where they did not give one. */
function sizeOf(whole: Response): number | null {
  const size = Number(whole.headers.get("Content-Length") ?? Number.NaN);
  return Number.isInteger(size) && size >= 0 ? size : null;
}

/** The file as it arrives with its size, or, where the assets gave no size, read whole to learn it. */
async function fileOf(
  whole: Response,
): Promise<{ readonly part: (range: ByteRange) => BodyInit; readonly size: number }> {
  const { body } = whole;
  const size = sizeOf(whole);
  if (body !== null && size !== null) return { part: (range) => slice(body, range), size };
  const file = await whole.arrayBuffer();
  return { part: (range) => file.slice(range.start, range.end + 1), size: file.byteLength };
}

/**
 * The part of `whole`, a file the assets gave in full, that `request` asks for: 206 with that part, 416 when there is
 * no such part, or the whole file. Every answer says parts may be asked for.
 */
export async function partOf(request: Request, whole: Response): Promise<Response> {
  if (whole.status !== 200) return whole;
  const headers = new Headers(whole.headers);
  headers.set("Accept-Ranges", "bytes");
  const header = request.method === "GET" ? request.headers.get("Range") : null;
  if (header === null) return new Response(whole.body, { status: 200, headers });

  const file = await fileOf(whole);
  const range = rangeOf(header, file.size);
  if (range === "whole") return new Response(file.part({ start: 0, end: file.size - 1 }), { status: 200, headers });

  headers.delete("Content-Length");
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${String(file.size)}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${String(range.start)}-${String(range.end)}/${String(file.size)}`);
  headers.set("Content-Length", String(range.end - range.start + 1));
  return new Response(file.part(range), { status: 206, headers });
}
