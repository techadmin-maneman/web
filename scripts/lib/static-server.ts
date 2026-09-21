// A small static file server for the built site and the design export, used
// by the fidelity harness and the browser tests. It resolves paths the way
// Workers static assets do for this site: / → index.html, /try → try.html,
// anything else missing → 404.html with status 404.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
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

export function serveDirectory(root: string, port: number): Promise<Server> {
  const server = createServer((request, response) => {
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
