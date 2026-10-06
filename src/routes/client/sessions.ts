// Where a client is signed in, and a way to end it (docs/decisions/0029-sessions.md):
//
//   GET    /api/sessions          the browsers signed in, this one marked
//   DELETE /api/sessions/others   signs out every browser but this one
//   DELETE /api/sessions/:id      signs one out; this one's own ends the session here, as a sign-out does
//
// A lost or handed-on phone stays signed in for 90 days from its last use; this ends it without erasing the account.

import { z } from "@hono/zod-openapi";
import { clientRoute } from "../../http/session-routes.ts";
import type { App } from "../../http/context.ts";
import { liveSessions, revokeByHandle, revokeOthersStatement, sessionHandle } from "../../domain/sign-in/sessions.ts";
import { clearClientCookie, clientOf } from "../../http/client-session.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";

const SignedInSchema = z
  .object({
    id: z.string().openapi({ description: "Names the session to this client, to sign it out; it opens nothing." }),
    device: z.union([z.string(), z.null()]).openapi({
      description: 'The browser and system it signed in from, "Chrome on Android"; null where they could not be told.',
    }),
    signed_in_at: z.iso.datetime(),
    last_used_at: z.iso.datetime().openapi({ description: "Kept to the hour: a session is touched at most hourly." }),
    this_device: z.boolean().openapi({ description: "Whether it is the session this request came with." }),
  })
  .strict()
  .openapi("SignedIn");

const HANDLE = z.string().regex(/^[0-9a-f]{16}$/);

const listRoute = clientRoute({
  method: "get",
  path: "/api/sessions",
  summary: "The browsers this client is signed in on, the one used last first",
  responses: {
    200: {
      description: "Signed in",
      ...json(
        z
          .object({ sessions: z.array(SignedInSchema) })
          .strict()
          .openapi("SignedInList"),
      ),
    },
    401: errorResponse("session_required"),
  },
});

const othersRoute = clientRoute({
  method: "delete",
  path: "/api/sessions/others",
  summary: "Sign out every browser but this one",
  responses: {
    204: { description: "Signed out, or there were none" },
    401: errorResponse("session_required"),
  },
});

const oneRoute = clientRoute({
  method: "delete",
  path: "/api/sessions/{id}",
  summary: "Sign one browser out; this one's own signs out here",
  request: { params: z.object({ id: HANDLE }) },
  responses: {
    204: { description: "Signed out" },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no live session of this client's by that ID"),
  },
});

export function registerClientSessions(app: App): void {
  app.openapi(listRoute, async (c) => {
    const session = clientOf(c);
    const live = await liveSessions(c.env.DB, { kind: "client", id: session.subjectId }, c.var.deps.now());
    const sessions = live.map(({ sessionId, signedIn }) => ({
      id: signedIn.id,
      device: signedIn.device,
      signed_in_at: signedIn.signedInAt,
      last_used_at: signedIn.lastUsedAt,
      this_device: sessionId === session.id,
    }));
    return c.json({ sessions }, 200);
  });

  app.openapi(othersRoute, async (c) => {
    const session = clientOf(c);
    await revokeOthersStatement(
      c.env.DB,
      { kind: "client", id: session.subjectId },
      session.id,
      c.var.deps.now(),
    ).run();
    return c.body(null, 204);
  });

  app.openapi(oneRoute, async (c) => {
    const session = clientOf(c);
    const handle = c.req.valid("param").id;
    const subject = { kind: "client", id: session.subjectId } as const;
    if (!(await revokeByHandle(c.env.DB, subject, handle, c.var.deps.now()))) {
      return refuse(c, "not_found");
    }
    if (handle === sessionHandle(session.id)) clearClientCookie(c);
    return c.body(null, 204);
  });
}
