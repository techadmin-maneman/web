// The ad platforms with nothing behind them, for local runs and the tests (docs/decisions/0288-attribution-and-
// conversions.md): each send is logged with the request the real platform would be given, holding hashes only, and
// taken. A test can make every send fail, as a platform that is down does, or refuse one for good.

import type { Logger } from "../../log.ts";
import type { ConversionPlatform, ConversionToSend, SendOutcome } from "./index.ts";
import { metaEvent } from "./meta.ts";

/** What every stub send answers while a test has set it; taken otherwise. */
export const STUB_ANSWER: { meta: SendOutcome | null; google: SendOutcome | null } = { meta: null, google: null };

/** Every send the stubs took, for the tests to read. */
export const STUB_SENT: { platform: "meta" | "google"; conversion: ConversionToSend }[] = [];

export function createStubConversions(platform: "meta" | "google", log: Logger): ConversionPlatform {
  return {
    send(conversion) {
      const answer = STUB_ANSWER[platform] ?? { kind: "sent" };
      if (answer.kind === "sent") STUB_SENT.push({ platform, conversion });
      log.info("conversion_stub", {
        platform,
        event: conversion.event,
        event_id: conversion.eventId,
        outcome: answer.kind,
        ...(platform === "meta" ? { meta_event: JSON.stringify(metaEvent(conversion)) } : {}),
      });
      return Promise.resolve(answer);
    },
  };
}
