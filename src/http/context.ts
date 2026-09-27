// What every handler is given: the Worker's bindings, and what src/app.ts sets on each request. Kept apart from
// src/app.ts, which imports every route, so that a route importing these types does not import every other route.

import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Surface } from "../config/environments.ts";
import type { Dependencies } from "../dependencies.ts";
import type { ReadOpsInputs } from "../domain/ops-settings.ts";
import type { Session } from "../domain/sessions.ts";
import type { IdentityCheck, StaticConfig } from "../guard.ts";
import type { Logger } from "../log.ts";
import type { AccessIdentity } from "./access.ts";
import type { TechnicianSession } from "./technician-session.ts";

/** What every handler can read from `c.env` and `c.var`. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    log: Logger;
    config: StaticConfig;
    deps: Dependencies;
    checkIdentity: IdentityCheck;
    /** The business inputs ops set, cached per isolate (ADR 0061). */
    readOpsInputs: ReadOpsInputs;
    surface: Surface;
    /** Set on the ops surface by requireAccess. */
    accessIdentity?: AccessIdentity;
    /** Set on the client surface's session routes by requireClientSession. */
    clientSession?: Session;
    /** Set on the technician surface's session routes by requireTechnicianSession. */
    technicianSession?: TechnicianSession;
  };
};

export type App = OpenAPIHono<AppEnv>;

export const REQUEST_ID_HEADER = "X-Request-Id";
