// A small static file server for the built site and the design export, used
// by the fidelity harness and the browser tests. It resolves paths the way
// Workers static assets do for this site: / → index.html, /try → try.html,
// anything else missing → 404.html with status 404.
//
// Given an API origin, it passes /api/* there, as Cloudflare routes /api/* to
// mm-api on the site's own host. A `_headers` file in the root is applied as
// Cloudflare applies it, so the tests run under the site's real policy.
//
// For a single-page app (`spa`), a page path with no file answers index.html,
// as Workers' single-page-application handling does. With `keepHost`, /api/*
// goes on with the browser's own Host header, as Cloudflare's routing keeps it:
// mm-api then chooses the app's surface by host, and a write's Origin matches
// the URL mm-api sees (docs/decisions/0026-hosts-and-surfaces.md).

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createGzip } from "node:zlib";
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
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml",
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

interface HeaderRule {
  readonly path: RegExp;
  readonly set: [string, string][];
  readonly unset: string[];
}

/** Reads a `_headers` file: a path pattern (`*` matches anything), then indented `Name: value` or `! Name` lines. */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const pattern = line
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace("*", ".*");
      rules.push({ path: new RegExp(`^${pattern}$`), set: [], unset: [] });
      continue;
    }
    const rule = rules.at(-1);
    const entry = line.trim();
    if (rule === undefined) continue;
    if (entry.startsWith("! ")) rule.unset.push(entry.slice(2).toLowerCase());
    else {
      const colon = entry.indexOf(":");
      rule.set.push([entry.slice(0, colon).trim().toLowerCase(), entry.slice(colon + 1).trim()]);
    }
  }
  return rules;
}

/**
 * The headers for a path. Every matching rule applies in order: its `!` lines
 * remove a header, and a header set twice is joined with a comma.
 */
export function headersFor(rules: readonly HeaderRule[], urlPath: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const path = urlPath.split("?")[0] ?? "/";
  for (const rule of rules.filter((candidate) => candidate.path.test(path))) {
    for (const name of rule.unset) Reflect.deleteProperty(headers, name);
    for (const [name, value] of rule.set) headers[name] = name in headers ? `${headers[name] ?? ""}, ${value}` : value;
  }
  return headers;
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

/** Forwards one request to the API with its own Host header, which fetch() cannot set. */
async function forwardKeepingHost(
  request: IncomingMessage,
  response: ServerResponse,
  apiOrigin: string,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const target = new URL(apiOrigin);
  const upstream = httpRequest(
    {
      host: target.hostname,
      port: target.port,
      path: request.url ?? "/",
      method: request.method,
      headers: request.headers,
    },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    },
  );
  upstream.on("error", () => response.writeHead(502).end("the API did not answer"));
  upstream.end(Buffer.concat(chunks));
}

export interface ServeOptions {
  /** A single-page app: a page path with no file answers index.html. */
  readonly spa?: boolean;
  /** Pass /api/* on with the browser's own Host header. */
  readonly keepHost?: boolean;
}

export function serveDirectory(
  root: string,
  port: number,
  apiOrigin?: string,
  options: ServeOptions = {},
): Promise<Server> {
  const headersPath = join(root, "_headers");
  const rules = isFile(headersPath) ? parseHeaders(readFileSync(headersPath, "utf8")) : [];
  const server = createServer((request, response) => {
    if (apiOrigin !== undefined && (request.url ?? "").startsWith("/api/")) {
      void (options.keepHost === true ? forwardKeepingHost : forward)(request, response, apiOrigin);
      return;
    }
    const pagePath = extname((request.url ?? "/").split("?")[0] ?? "") === "";
    const found =
      resolveFile(root, request.url ?? "/") ?? (options.spa === true && pagePath ? join(root, "index.html") : null);
    const file = found ?? join(root, "404.html");
    if (!isFile(file)) {
      response.writeHead(404).end("not found");
      return;
    }
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    // Text is compressed, as Cloudflare compresses it; images, fonts and video already are.
    const compressible = /^text\/|^application\/(json|xml)|svg/.test(type);
    const compress = compressible && (request.headers["accept-encoding"] ?? "").includes("gzip");
    response.writeHead(found === null ? 404 : 200, {
      ...headersFor(rules, request.url ?? "/"),
      "Content-Type": type,
      ...(compress ? { "Content-Encoding": "gzip", Vary: "Accept-Encoding" } : {}),
    });
    const body = createReadStream(file);
    if (compress) body.pipe(createGzip()).pipe(response);
    else body.pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}
