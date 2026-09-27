// Which surface a request is for, from its host, and the one app that answers
// it (docs/decisions/0026-hosts-and-surfaces.md).

import { REQUEST_ID_HEADER, type App } from "./context.ts";
import { ENABLED_SURFACES, SURFACE_HOSTS, type EnvironmentName, type Surface } from "../config/environments.ts";
import { errorBody } from "./errors.ts";

/** Local subdomains of localhost, each a surface; anything else local is the public site. */
const LOCAL_SUBDOMAINS: Readonly<Record<string, Surface>> = { app: "client", ops: "ops", tech: "tech" };

/**
 * The surface a hostname belongs to, or null if this environment does not
 * serve it. Remote environments match exactly and only switched-on surfaces.
 * Locally, app., ops. and tech.localhost are theirs, and every other host
 * (localhost, 127.0.0.1, a test's) is the public site.
 */
export function surfaceOf(hostname: string, environment: EnvironmentName): Surface | null {
  const enabled = ENABLED_SURFACES[environment];
  if (environment === "local") {
    const [label = "", ...rest] = hostname.split(".");
    const local = rest.join(".") === "localhost" ? LOCAL_SUBDOMAINS[label] : undefined;
    const surface = local ?? "public";
    return enabled.includes(surface) ? surface : null;
  }
  return enabled.find((surface) => SURFACE_HOSTS[environment][surface] === hostname) ?? null;
}

/** Sends each request to its host's app. A host this environment does not serve gets a bare 404. */
export function byHost(apps: ReadonlyMap<Surface, App>, environment: EnvironmentName) {
  return (request: Request, workerEnv: Env, context?: ExecutionContext): Response | Promise<Response> => {
    const surface = surfaceOf(new URL(request.url).hostname, environment);
    const app = surface === null ? undefined : apps.get(surface);
    return app === undefined ? unknownHost() : app.fetch(request, workerEnv, context);
  };
}

function unknownHost(): Response {
  const requestId = crypto.randomUUID();
  return Response.json(errorBody("not_found", requestId), {
    status: 404,
    headers: { [REQUEST_ID_HEADER]: requestId, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
