// A "Payment owed" task's link, as the API gives it: Razorpay sent it, has still to, refused it, or it closed unpaid.

export type LinkState = "sent" | "unsent" | "refused" | "closed";
