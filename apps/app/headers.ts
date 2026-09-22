// The client app's policy (docs/decisions/0043-client-app.md). WebOTP reads
// the login code from an SMS where the phone allows (board A2). Razorpay's
// hosts join with self-serve payment (P2-F5).

import type { AppPolicy } from "@maneman/web-kit/headers";

export const CLIENT_APP_POLICY: AppPolicy = {
  features: ["otp-credentials"],
};
