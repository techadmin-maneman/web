// A payment made by UPI outside Razorpay, while online payment is off (docs/decisions/0208-paid-at-the-visit-by-upi.md):
// its Razorpay ID is the UPI transaction's reference under this mark, so Razorpay is never asked about it.

export const UPI_MARK = "upi:";

/** Whether a payment was made by UPI outside Razorpay, which Razorpay can neither read back nor refund. */
export const paidOutsideRazorpay = (razorpayPaymentId: string): boolean => razorpayPaymentId.startsWith(UPI_MARK);
