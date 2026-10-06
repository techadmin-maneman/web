// The client's consents (./profile.ts): one switched on or off, audited in the same batch as the switch. A switch
// to the state a purpose already holds writes neither a ledger row (ADR 0058) nor an audit entry.

import { z } from "@hono/zod-openapi";
import { switchNotice } from "../../config/notices.ts";
import { consentsOf } from "../../domain/clients/profile.ts";
import { auditStatementIfWritten } from "../../domain/ops/audit.ts";
import { recordConsent } from "../../domain/privacy/consents.ts";
import { revokeCard } from "../../domain/referrals/referral-cards.ts";
import { clientAudit } from "../../http/audit.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute, signedIn } from "../../http/session-routes.ts";
import { visitorOf } from "../../http/visitor.ts";
import { APP_SWITCH_SOURCES, CONSENT_PURPOSES, screenAsks } from "../../policy/consents.ts";

const ConsentSwitchSchema = z
  .object({
    granted: z.boolean(),
    source: z.enum(APP_SWITCH_SOURCES).optional().openapi({
      description:
        "The app's screen the switch was made on: the profile (any purpose), the booking sheet (whatsapp_visits) or the share sheet (photos_referral_cards). Kept on the consent; one sent without it is kept with no place, and one that does not ask for the purpose is refused.",
    }),
  })
  .strict()
  .openapi("ConsentSwitch");

const consentRoute = clientRoute({
  method: "patch",
  path: "/api/consents/{purpose}",
  summary: "Switch one consent on or off. Each switch is kept, with its date; a repeat is not a switch",
  request: {
    params: z.object({ purpose: z.enum(CONSENT_PURPOSES) }),
    body: { required: true, ...json(ConsentSwitchSchema) },
  },
  responses: {
    200: {
      description: "Switched",
      ...json(z.object({ purpose: z.enum(CONSENT_PURPOSES), granted: z.boolean(), since: z.iso.datetime() }).strict()),
    },
    400: errorResponse("invalid_request: the screen named does not ask for this purpose"),
    ...signedIn,
  },
});

export function registerClientConsents(app: App): void {
  app.openapi(consentRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const { purpose } = c.req.valid("param");
    const { granted, source = null } = c.req.valid("json");
    // A screen is kept against a consent only if it asks for it (docs/decisions/0094-where-a-consent-was-given.md).
    if (source !== null && !screenAsks(source, purpose)) {
      return refuse(c, "invalid_request", ["source"]);
    }
    const now = c.var.deps.now();
    const db = c.env.DB;
    const consent = recordConsent(db, {
      person: { id: personId },
      purpose,
      granted,
      notice: switchNotice(purpose, source),
      source,
      rule: "if_changed",
      ipHash: (await visitorOf(c)).ipHash,
      givenAt: now.toISOString(),
    });
    const [switched] = await db.batch<{ created_at: string }>([
      consent.statement,
      auditStatementIfWritten(
        db,
        clientAudit(personId, c.var.requestId, { action: "consent.switch", detail: { purpose, granted } }),
        now,
        { table: "consents", id: consent.id },
      ),
    ]);
    // "You can switch it off at any time, and new opens will show our house example instead."
    if (purpose === "photos_referral_cards" && !granted) await revokeCard(db, c.env.REFERRAL_CARDS, personId, now);
    // A request that changed nothing is answered with the date the ledger holds, not with its own
    // moment: the client is told when they agreed, which is not necessarily now (ADR 0058).
    const written = switched?.results[0]?.created_at;
    const since = written ?? (await consentsOf(db, personId)).find((one) => one.purpose === purpose)?.since;
    return c.json({ purpose, granted, since: since ?? now.toISOString() }, 200);
  });
}
