// Calls AILabTools directly, through the real adapter, for the two M3 proofs
// that cannot go through our API. The key is read from the environment and
// never printed.
//
//   node --env-file=.env.worker-staging scripts/ailabtools-probe.ts credits
//   node --env-file=.env.worker-staging scripts/ailabtools-probe.ts poll <task_id> pro|premium
//   node --env-file=.env.worker-staging scripts/ailabtools-probe.ts wrong-extension <photo.jpg>
//   node --env-file=.env.worker-staging scripts/ailabtools-probe.ts rejected <photo> [<photo> …]
//
// wrong-extension  sends the photo to Premium named .avif, which our API never
//                  does, and shows how the adapter classifies the refusal.
// rejected         submits each photo to Pro, follows it to the end, and
//                  compares the credit balance before and after.
//
// Photos are read from disk and never copied into the repository.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { PRESETS } from "../src/config/presets.ts";
import { createLogger } from "../src/log.ts";
import { createAilabtoolsProvider } from "../src/providers/ailabtools.ts";
import type { ImageProvider, PollResult } from "../src/providers/image.ts";

const POLL_EVERY_MS = 5_000;
const GIVE_UP_AFTER_MS = 240_000;
/** Billing can lag the result by a moment. */
const SETTLE_MS = 10_000;

const env = (name: string): string => process.env[name]?.trim() ?? "";
const apiKey = env("AILAB_API_KEY");
if (apiKey === "") {
  console.error("AILAB_API_KEY is not set; pass the secrets file with --env-file");
  process.exit(2);
}
const preset = PRESETS[0];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fetch that renames the uploaded image part, to trip Premium's extension check (API notes, 7.2). */
function renamingFetch(newName: string): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== "POST") return fetch(request);
    const form = await request.formData();
    const image = form.get("image");
    if (image instanceof File) form.set("image", new File([await image.arrayBuffer()], newName, { type: image.type }));
    return fetch(request.url, { method: "POST", headers: { "ailabapi-api-key": apiKey }, body: form });
  };
}

async function follow(image: ImageProvider, taskId: string): Promise<PollResult> {
  const started = Date.now();
  for (;;) {
    await sleep(POLL_EVERY_MS);
    const result = await image.poll(taskId, "pro");
    if (result.state !== "running" || Date.now() - started > GIVE_UP_AFTER_MS) return result;
  }
}

async function credits(image: ImageProvider): Promise<number> {
  const balance = await image.credits();
  if (balance === null) throw new Error("could not read the credit balance");
  return balance;
}

const [command, ...paths] = process.argv.slice(2);
const image = createAilabtoolsProvider({ apiKey, fetch, log: createLogger() });

if (command === "credits") {
  console.log(`balance: ${String(await credits(image))} credits`);
} else if (command === "poll" && (paths[1] === "pro" || paths[1] === "premium")) {
  // A task by its ID, e.g. one the render consumer gave up on (tryon_jobs.provider_task_id).
  const result = await image.poll(paths[0] ?? "", paths[1]);
  let detail = "";
  if (result.state === "done") detail = "a result URL is waiting";
  if (result.state === "failed") detail = result.failure.detail;
  console.log(`task: ${result.state} ${detail}`);
} else if (command === "wrong-extension" && paths[0] !== undefined) {
  const photo = new Uint8Array(readFileSync(paths[0]));
  const renamed = createAilabtoolsProvider({ apiKey, fetch: renamingFetch("portrait.avif"), log: createLogger() });
  const before = await credits(image);
  const result = await renamed.submit(photo, preset, "original", "premium");
  console.log(
    JSON.stringify(
      result.ok ? { accepted: result.taskId } : { failure_code: result.failure.code, detail: result.failure.detail },
      null,
      2,
    ),
  );
  await sleep(SETTLE_MS);
  console.log(`credits: ${String(before)} before, ${String(await credits(image))} after`);
} else if (command === "rejected" && paths.length > 0) {
  const before = await credits(image);
  for (const path of paths) {
    const started = Date.now();
    const submitted = await image.submit(new Uint8Array(readFileSync(path)), preset, "black", "pro");
    const outcome = submitted.ok
      ? await follow(image, submitted.taskId)
      : { state: "failed" as const, failure: submitted.failure };
    let summary = "still running after 4 minutes";
    if (outcome.state === "done") summary = "rendered (billed)";
    if (outcome.state === "failed") summary = `refused: ${outcome.failure.code} ${outcome.failure.detail}`;
    console.log(
      `${basename(path)}: ${submitted.ok ? "accepted, then " : ""}${summary} (${String(Date.now() - started)} ms)`,
    );
  }
  await sleep(SETTLE_MS);
  const after = await credits(image);
  console.log(`credits: ${String(before)} before, ${String(after)} after: ${String(before - after)} spent`);
} else {
  console.error(
    "usage: ailabtools-probe.ts credits | poll <task_id> pro|premium | wrong-extension <photo> | rejected <photo> [<photo> …]",
  );
  process.exit(2);
}
