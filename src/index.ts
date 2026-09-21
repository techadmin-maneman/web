import { env } from "cloudflare:workers";
import { createApp } from "./app.ts";
import { validateStaticConfig } from "./guard.ts";

// Runs at module load. A Worker without a valid ENVIRONMENT, or a production
// Worker holding a stub provider, throws here: Cloudflare rejects the upload
// and wrangler dev refuses to start.
const config = validateStaticConfig(env as unknown as Record<string, unknown>);

const app = createApp(config);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
