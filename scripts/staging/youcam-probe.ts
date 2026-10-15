// Calls YouCam directly, through the real adapter, for what cannot be measured through our API: every look on one
// photograph, each timed, with the units the balance lost. The key is read from the environment and never printed.
//
//   node --env-file=<secrets> scripts/staging/youcam-probe.ts units
//   node --env-file=<secrets> scripts/staging/youcam-probe.ts poll <task_id>
//   node --env-file=<secrets> scripts/staging/youcam-probe.ts looks <photo.jpg> [--out <folder>] [--refs <url>]
//
// looks  renders the photograph in each of the six looks, one after another, polling every 2 s as the render consumer
//        does, and saves each result to --out when given. The photograph must already be as the site prepares it: a
//        JPEG, 1024 px on its long side at most. --refs is where YouCam fetches the references, TRYON_REFS_URL by
//        default.
//
// Photos are read from disk and never copied into the repository.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { PRESETS } from "../../src/config/presets.ts";
import { createLogger } from "../../src/log.ts";
import type { ImageProvider, PollResult } from "../../src/providers/image/index.ts";
import { createYoucamProvider } from "../../src/providers/image/youcam.ts";

const POLL_EVERY_MS = 2_000;
const GIVE_UP_AFTER_MS = 120_000;
/** The balance can lag a render by a moment. */
const SETTLE_MS = 5_000;

const env = (name: string): string => process.env[name]?.trim() ?? "";
const apiKey = env("YOUCAM_API_KEY");
if (apiKey === "") {
  console.error("YOUCAM_API_KEY is not set; pass the secrets file with --env-file");
  process.exit(2);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function follow(image: ImageProvider, taskId: string): Promise<PollResult> {
  const started = Date.now();
  for (;;) {
    await sleep(POLL_EVERY_MS);
    const result = await image.poll(taskId);
    if (result.state !== "running" || Date.now() - started > GIVE_UP_AFTER_MS) return result;
  }
}

async function units(image: ImageProvider): Promise<number> {
  const balance = await image.credits();
  if (balance === null) throw new Error("could not read the unit balance");
  return balance;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, refs: { type: "string", default: "https://maneman.in/refs/v1" } },
});
const [command, argument] = positionals;
const image = createYoucamProvider({ apiKey, fetch, log: createLogger(), refsUrl: values.refs });

if (command === "units") {
  console.log(`balance: ${String(await units(image))} units`);
} else if (command === "poll" && argument !== undefined) {
  const result = await image.poll(argument);
  const detail = result.state === "failed" ? result.failure.detail : "";
  console.log(`task: ${result.state} ${detail}`);
} else if (command === "looks" && argument !== undefined) {
  const photo = new Uint8Array(readFileSync(argument));
  if (values.out !== undefined) mkdirSync(values.out, { recursive: true });
  let before = await units(image);
  console.log(`balance before: ${String(before)} units`);
  for (const preset of PRESETS) {
    const started = Date.now();
    const submitted = await image.submit(photo, preset.id);
    const result = submitted.ok ? await follow(image, submitted.taskId) : null;
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (result?.state === "done") {
      const downloaded = await image.download(result.resultUrl);
      if (downloaded.ok && values.out !== undefined)
        writeFileSync(join(values.out, `${preset.id}.jpg`), downloaded.bytes);
    }
    await sleep(SETTLE_MS);
    const after = await units(image);
    let outcome = "running past the give-up time";
    if (!submitted.ok) outcome = `refused: ${submitted.failure.detail}`;
    else if (result?.state === "done") outcome = "ok";
    else if (result?.state === "failed") outcome = `failed: ${result.failure.detail}`;
    console.log(`${preset.id}: ${outcome}, ${seconds} s, ${String(before - after)} units`);
    before = after;
  }
} else {
  console.error("usage: youcam-probe.ts units | poll <task_id> | looks <photo.jpg> [--out <folder>] [--refs <url>]");
  process.exit(2);
}
