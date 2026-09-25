// What a shared invite says in the chat (design/phase2/Referral and Waitlist,
// boards B1 and B2): the title and the line beneath it that WhatsApp draws from
// the landing's Open Graph tags. The mm-site Worker writes them into those tags
// (site/src/worker.ts), and the client app's preview (board F4) shows the same
// words, so a client sees exactly what their friend will.

/** The referrer is named only if they agreed to it and naming is on; otherwise the title names nobody. */
export function inviteTitle(name: string | null): string {
  return name === null ? "You have a Mane Man invite" : `${name} sent you a Mane Man invite`;
}

export const INVITE_DESCRIPTION = "Home-fitted hair systems in Gurgaon. 3 service visits free when you're fitted.";
