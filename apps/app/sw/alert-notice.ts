// What a push shows on the client's phone (docs/decisions/0255-client-alerts-and-push.md), apart from the worker's
// events so it can be tested: how many alerts are new, read from the inbox, and the one notification that says so,
// which opens the inbox. Its few words are its own: what the app and the worker share would be a chunk the worker, a
// classic script, cannot load.

/** The worker's words. */
export const WORDS = {
  title: "Mane Man",
  one: "You have a new update.",
  many: (count: number) => `You have ${String(count)} new updates.`,
} as const;

/** Where a tap on the notification goes. */
export const OPENS = "/alerts";

/** How many of the inbox's alerts are not read, from its answer; null for an answer that is not the inbox. */
export function unreadIn(body: unknown): number | null {
  if (typeof body !== "object" || body === null || !("alerts" in body) || !Array.isArray(body.alerts)) return null;
  return (body.alerts as readonly { readonly read?: unknown }[]).filter((alert) => alert.read === false).length;
}

/**
 * The one notification a push shows, as the phones require of every push, even when the inbox could not be read: how
 * many are new where more than one is, else that there is one. A later push's replaces the earlier one's.
 */
export function noticeOf(unread: number | null): { title: string; body: string; tag: string; icon: string } {
  return {
    title: WORDS.title,
    body: unread !== null && unread > 1 ? WORDS.many(unread) : WORDS.one,
    tag: "mm-alerts",
    icon: "/icon-192.png",
  };
}
