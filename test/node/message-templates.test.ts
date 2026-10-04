// The classification that decides which queued WhatsApp messages answer the person who just acted, and which are
// automatic (src/config/message-templates.ts; ADR 0097, "Staging logins open, reminders fenced").

import { describe, expect, it } from "vitest";
import {
  MESSAGE_CLASSES,
  messageClass,
  renderMessage,
  renderWithStopLink,
  STOP_LINKS,
  stopLinkPurpose,
} from "../../src/config/message-templates.ts";
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
      "visit_cancelled", // ops cancelled it in the console
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

  // PS-29: the answer to a STOP reply reaches the number that sent it, as any answer does.
  it("classes the answer to a STOP reply as answering", () => {
    expect(messageClass("messages_stopped")).toBe("answering");
  });
});

// PS-29: a reminder or the launch alert gave no way to stop it without signing in.
describe("the link that stops a message", () => {
  it("ends the reminders and the launch alert, each withdrawing the consent it was sent under", () => {
    expect(STOP_LINKS).toEqual({
      visit_reminder: "whatsapp_visits",
      next_service_reminder: "whatsapp_visits",
      credits_expiring: "whatsapp_visits",
      launch_alert: "whatsapp_launches",
    });
    for (const kind of Object.keys(STOP_LINKS)) expect(messageClass(kind), kind).toBe("automatic");
    expect(stopLinkPurpose("tryon_result")).toBeNull();
  });

  it("goes on a line of its own at the end of the text, and only when there is one", () => {
    const params = ["Arjun", "Sector 65", "https://maneman.in/book"];
    expect(renderWithStopLink("launch_alert_v1", params)).toBe(renderMessage("launch_alert_v1", params));
    expect(renderWithStopLink("launch_alert_v1", params, "https://maneman.in/stop#t")).toBe(
      `${renderMessage("launch_alert_v1", params) ?? ""}\n\nStop these messages: https://maneman.in/stop#t`,
    );
  });
});
