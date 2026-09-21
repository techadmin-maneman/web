// A small static file server for the built site and the design export, used
// by the fidelity harness and the browser tests. It resolves paths the way
// Workers static assets do for this site: / → index.html, /try → try.html,
// anything else missing → 404.html with status 404.
//
// Given an API origin, it passes /api/* there, as Cloudflare routes /api/* to
// mm-api on the site's own host.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** The file a request path maps to, or null. */
export function resolveFile(root: string, urlPath: string): string | null {
  const base = resolve(root);
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const path = normalize(join(base, decoded));
  if (path !== base && !path.startsWith(base + sep)) return null;
  for (const candidate of [path, `${path}.html`, join(path, "index.html")]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Forwards one request to the API and streams its answer back. */
async function forward(request: IncomingMessage, response: ServerResponse, apiOrigin: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (key !== "host" && typeof value === "string") headers.set(key, value);
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const answer = await fetch(`${apiOrigin}${request.url ?? "/"}`, {
      method: request.method ?? "GET",
      headers,
      ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
    });
    const outgoing: Record<string, string> = {};
    answer.headers.forEach((value, key) => {
      if (key !== "content-encoding" && key !== "content-length") outgoing[key] = value;
    });
    response.writeHead(answer.status, outgoing).end(Buffer.from(await answer.arrayBuffer()));
  } catch {
    response.writeHead(502).end("the API did not answer");
  }
}

export function serveDirectory(root: string, port: number, apiOrigin?: string): Promise<Server> {
  const server = createServer((request, response) => {
    if (apiOrigin !== undefined && (request.url ?? "").startsWith("/api/")) {
      void forward(request, response, apiOrigin);
      return;
    }
    const found = resolveFile(root, request.url ?? "/");
    const file = found ?? join(root, "404.html");
    if (!isFile(file)) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(found === null ? 404 : 200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}
