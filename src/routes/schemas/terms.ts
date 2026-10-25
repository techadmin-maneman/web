// The agreement every form that books asks for, a box the visitor ticks themselves: kept with the versions of the terms
// and the privacy policy the site publishes (src/domain/privacy/terms-acceptances.ts).

import { z } from "@hono/zod-openapi";

export const TermsSchema = z.literal(true).openapi({
  description:
    '"I agree to the Terms and Conditions and the Privacy Policy." Required, and recorded with their versions.',
});
