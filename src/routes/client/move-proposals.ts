// A client accepting the move to another day ops asked of them (src/domain/dispatch/move-proposals.ts,
// docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md):
//
//   POST /api/visits/:id/proposed-move/accept   the visit moves where the proposal puts it, its checks run again
//
// The proposal itself is the visit's proposed_move, on Home and on Visits. Picking another time instead is the
// client's own move (POST /api/holds with moving), which makes the proposal moot.

import { z } from "@hono/zod-openapi";
import { acceptProposal } from "../../domain/dispatch/move-proposals.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { queueMessage } from "../../http/queue-message.ts";
import { clientRoute } from "../../http/session-routes.ts";

const acceptRoute = clientRoute({
  method: "post",
  path: "/api/visits/{id}/proposed-move/accept",
  summary: "Accept the move to another day ops asked of the client: the visit moves there",
  request: { params: z.object({ id: z.uuid().openapi({ description: "The visit's ID." }) }) },
  responses: {
    200: {
      description: "Moved; the visit's new window goes to the client as any move's does",
      ...json(
        z
          .object({ moved: z.literal(true) })
          .strict()
          .openapi("ProposedMoveAccepted"),
      ),
    },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no proposal open on a visit of this client's, or it has run out"),
    409: errorResponse("move_gone: that time was taken since, or the visit cannot move now; the client picks again"),
  },
});

export function registerClientMoveProposals(app: App): void {
  app.openapi(acceptRoute, async (c) => {
    const session = clientOf(c);
    const appointmentId = c.req.valid("param").id;
    const accepted = await acceptProposal(
      c.env.DB,
      { notify: (messageId) => queueMessage(c, messageId) },
      {
        appointmentId,
        personId: session.subjectId,
        audit: {
          surface: "client",
          actor: { kind: "client", id: session.subjectId },
          action: "visit.move_accepted",
          subject: { kind: "appointment", id: appointmentId },
          requestId: c.var.requestId,
        },
        now: c.var.deps.now(),
      },
    );
    if (accepted === "none") return refuse(c, "not_found");
    if (accepted === "gone") return refuse(c, "move_gone");
    return c.json({ moved: true as const }, 200);
  });
}
