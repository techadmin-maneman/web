// The classification that decides which queued WhatsApp messages answer the person who just acted, and which are
// automatic (src/config/message-templates.ts; ADR 0097, "Staging logins open, reminders fenced").

import { describe, expect, it } from "vitest";
import { MESSAGE_CLASSES, messageClass } from "../../src/config/message-templates.ts";
import { MESSAGE_KINDS } from "../../src/domain/messages.ts";

describe("the message class table", () => {
  it("covers every kind, once each", () => {
    expect(Object.keys(MESSAGE_CLASSES).sort()).toEqual([...MESSAGE_KINDS].sort());
  });

  it("classes a booking, a move, a cancel and a claimed result as answering the person who acted", () => {
    for (const kind of [
      "tryon_result",
      "consultation_confirmation",
      "payment_receipt",
      "reschedule_confirmation",
      "cancel_confirmation",
      "waitlist_confirmation",
    ] as const) {
      expect(MESSAGE_CLASSES[kind], kind).toBe("answering");
    }
  });

  it("classes a scheduled message, and one to someone other than who acted, as automatic", () => {
    for (const kind of [
      "visit_reminder",
      "next_service_reminder",
      "launch_alert",
      "visit_moved", // ops moved it, not the client
      "arrival_notice", // the technician's own action
      "no_show_decided", // ops ruled on it
      "friend_fitted", // the friend acted; the referrer is told
      "friend_credited",
      "referral_rejected",
    ] as const) {
      expect(MESSAGE_CLASSES[kind], kind).toBe("automatic");
    }
  });

  it("defaults an unrecognised kind to automatic, so an unsure case never opens up", () => {
    expect(messageClass("something_new")).toBe("automatic");
  });

  it("reads a real kind's class through the same helper", () => {
    expect(messageClass("tryon_result")).toBe("answering");
    expect(messageClass("visit_reminder")).toBe("automatic");
  });
});
