// The try-on's result as a message (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md): the person's look,
// within the daily cap on result messages to one number, linked fresh for each try. The messaging consumer sends it
// (./messaging.ts).

import { PUBLIC_ORIGIN } from "../config/environments.ts";
import { RESULT_TEMPLATE } from "../config/message-templates.ts";
import { RESULT_LINK_MESSAGE_TTL_MS } from "../config/tryon.ts";
import type { StaticConfig } from "../guard.ts";
import { mobileHashOf } from "../domain/clients/number-codes.ts";
import { takeOne } from "../domain/sign-in/rate-limit.ts";
import { typeOfKey } from "../lib/image-bytes.ts";
import { firstNameOf } from "../lib/names.ts";
import { signToken } from "../lib/signed-token.ts";
import type { Sendable } from "./messaging.ts";

interface ResultRow {
  readonly subject_id: string;
  readonly attempts: number;
  readonly mobile_e164: string;
  readonly name: string;
}

/** The try-on result: the person's result image, within the daily cap on result messages to one number. */
export async function resultContent(
  db: D1Database,
  config: StaticConfig,
  row: ResultRow,
  now: Date,
): Promise<Sendable | { readonly skip: string }> {
  const { tryon } = config.settings;
  const job = await db
    .prepare("SELECT result_key, state FROM tryon_jobs WHERE id = ?1")
    .bind(row.subject_id)
    .first<{ result_key: string | null; state: string }>();
  if (job?.state !== "ready" || job.result_key === null) return { skip: "no result to send" };
  if (row.attempts === 0) {
    // The daily cap on try-on results sent to one number, which the gate checks before a look is made.
    const key = await mobileHashOf(config.settings.ipHashSalt, row.mobile_e164);
    const withinCap = await takeOne(db, "message:result:mobile", key, { now, settings: config.settings });
    if (!withinCap) return { skip: "daily message limit reached" };
  }
  const resultKey = job.result_key;
  return {
    template: RESULT_TEMPLATE,
    // Greeted by first name, and sent on to book the consultation that shows it for real.
    params: [firstNameOf(row.name), `${PUBLIC_ORIGIN[config.environment]}/book`],
    // The provider fetches the image when it sends, declared as what the render stored.
    media: {
      url: async () => {
        const token = await signToken(
          tryon.linkSigningKey,
          "result",
          resultKey,
          new Date(now.getTime() + RESULT_LINK_MESSAGE_TTL_MS),
        );
        return `${PUBLIC_ORIGIN[config.environment]}/api/result/${token}`;
      },
      type: typeOfKey(resultKey),
    },
  };
}
