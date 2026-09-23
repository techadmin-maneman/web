// What the technician app's service worker needs from the build: the list of
// files it keeps, and a version that changes whenever one of them does, so a
// new build installs afresh and drops the old files (apps/tech/sw/sw.ts).
//
// The technician app has no manifest and no icons of its own: it is opened from
// a link ops send, not installed from a store, and every other surface's
// install is the client app's (docs/decisions/0043-client-app.md).

import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/** The files the service worker keeps: every file of the build, with the app itself kept as "/". */
export function precacheList(fileNames: readonly string[]): string[] {
  const files = fileNames.filter((name) => name !== "index.html" && name !== "sw.js");
  return ["/", ...[...new Set(files)].sort().map((name) => `/${name}`)];
}

/** Changes whenever any kept file does, so the service worker installs afresh and drops the old files. */
export function version(files: readonly { name: string; content: string | Uint8Array }[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(file.name).update(file.content);
  }
  return hash.digest("hex").slice(0, 12);
}

export function serviceWorker(): Plugin {
  return {
    name: "mm-tech-sw",
    apply: "build",
    generateBundle(_options, bundle) {
      const worker = bundle["sw.js"];
      if (worker?.type !== "chunk" || !/\bMM_PRECACHE\b/.test(worker.code) || !/\bMM_VERSION\b/.test(worker.code)) {
        throw new Error("the build has no sw.js waiting for its file list");
      }
      const kept = Object.values(bundle)
        .filter((item) => item.fileName !== "sw.js")
        .map((item) => ({ name: item.fileName, content: item.type === "chunk" ? item.code : item.source }));
      worker.code = worker.code
        .replace(/\bMM_PRECACHE\b/g, JSON.stringify(precacheList(kept.map((file) => file.name))))
        .replace(/\bMM_VERSION\b/g, JSON.stringify(version(kept)));
    },
  };
}
