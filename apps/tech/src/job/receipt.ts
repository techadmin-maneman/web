// What the WhatsApp to the client at the door came to, a no-show's first piece of evidence (./DoorScreen.tsx): done
// only once it was delivered. One sent and never delivered, or none at all, proves nothing.

import type { Job } from "../api.ts";
import { notHome } from "../content.ts";
import { clock } from "../lib/when.ts";

const copy = notHome.door;

export function whatsAppState(reminder: Job["reminder"]): { readonly done: boolean; readonly state: string } {
  if (reminder === null) return { done: false, state: copy.noneSent };
  if (reminder.state === "on_its_way") return { done: false, state: copy.onItsWay };
  if (reminder.delivered_at === null) return { done: false, state: copy.notDelivered };
  return { done: true, state: copy.delivered(clock(reminder.delivered_at)) };
}
