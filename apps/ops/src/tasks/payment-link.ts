// A "Payment owed" task's link, as the API gives it: whether Razorpay sent it, has still to, refused it or it closed
// unpaid; what it asks for in paise; its address, null until Razorpay made it; and the product's name.

import type { Task } from "../api.ts";

export type OwedLink = Extract<Task["facts"], { group: "payment_owed" }>;
export type LinkState = OwedLink["state"];

/** The link the task is about; null for a task of another group. */
export const owedLinkOf = (task: Task): OwedLink | null => (task.facts.group === "payment_owed" ? task.facts : null);
