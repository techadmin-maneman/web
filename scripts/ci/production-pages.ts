// Production's pages, as `npm run build` left them in site/dist/production, opened in Chromium from a local server:
// a page that throws, logs an error or asks for one of its own files that is not there fails the pull request, not
// the release. Production's own headers and edge are smoke:csp's, after a deploy.
//
//   node scripts/ci/production-pages.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = "site/dist/production";
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

const pages = readdirSync(ROOT, { recursive: true })
  .map((file) => String(file).replaceAll("\\", "/"))
  .filter((file) => file.endsWith(".html"));
if (pages.length === 0) {
  console.error(`${ROOT} holds no page: run npm run build first`);
  process.exit(2);
}

const server = createServer((request, response) => {
  const asked = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  let path = normalize(join(ROOT, asked));
  if (!path.startsWith(normalize(ROOT))) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (statSync(path).isDirectory()) path = join(path, "index.html");
    response.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    response.end(readFileSync(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : 0)}`;

// The API is mm-api's, not the site build's: a page's call to it answers 404 here, and is no file missing.
const API = `${origin}/api/`;
// Production's analytics tags answer empty, so a check sends no visit to production's own analytics.
const TAGS =
  /^https:\/\/([a-z0-9-]+\.)*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|facebook\.net)\//;

const browser = await chromium.launch();
const problems: string[] = [];
try {
  for (const page of pages) {
    const tab = await browser.newPage();
    await tab.route(TAGS, (route) => route.fulfill({ status: 204 }));
    const url = `${origin}/${page === "index.html" ? "" : page}`;
    tab.on("pageerror", (error) => problems.push(`${page}: ${error.message}`));
    tab.on("console", (message) => {
      if (message.type() !== "error" || message.location().url.startsWith(API)) return;
      problems.push(`${page}: console: ${message.text()}`);
    });
    tab.on("response", (answer) => {
      if (answer.url().startsWith(API)) return;
      if (answer.url().startsWith(origin) && answer.status() === 404 && answer.url() !== url) {
        problems.push(`${page}: ${answer.url().slice(origin.length)} is not in the build`);
      }
    });
    await tab.goto(url, { waitUntil: "networkidle" });
    await tab.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${String(pages.length)} production pages open without an error`);
