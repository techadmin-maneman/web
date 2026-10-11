// Lays the published words over a copy module's exports (docs/decisions/0127-publishing-the-words.md). Each copy
// module calls it on its own exports as it is built (./published-words.ts), in the pages and in the islands alike,
// so it imports nothing.

/** Each published line: its key, as src/config/words.json names it ("site:home/hero.title"), and its words. */
export type PublishedWords = Readonly<Record<string, string>>;

/**
 * Sets a module's published lines on its exports: "site:home/hero.title" sets home's `hero.title`. A line whose place
 * no longer holds words, the copy having moved since, is left as the code has it.
 */
export function applyWords(module: string, exports: Record<string, unknown>, words: PublishedWords): void {
  const prefix = `site:${module}/`;
  for (const [key, text] of Object.entries(words)) {
    if (!key.startsWith(prefix)) continue;
    const [name = "", ...path] = key.slice(prefix.length).split(".");
    const last = path.pop();
    let parent: unknown = exports[name];
    for (const step of path) parent = typeof parent === "object" && parent !== null ? Reflect.get(parent, step) : null;
    if (last === undefined || typeof parent !== "object" || parent === null) continue;
    if (typeof Reflect.get(parent, last) === "string") Reflect.set(parent, last, text);
  }
}
