// Who acts on each kind of alert on Tasks' "Needs a hand", which kinds' work can be sent again, and how often the
// chat is told again of one still open (src/policy/alerts.ts).

import { describe, expect, it } from "vitest";
import {
  alertDepartment,
  alertKind,
  alertSubject,
  crmErasureKey,
  crmLeadKey,
  deletionWaitingKey,
  markDoneLevel,
  maySendAgain,
  messageFailedKey,
  retellAfterHours,
} from "../../src/policy/alerts.ts";

describe("an alert's key", () => {
  it("names its kind up to the first colon, and what it is about after it", () => {
    expect(alertKind("no_show_refund_failed:waived:visit-1")).toBe("no_show_refund_failed");
    expect(alertSubject("no_show_refund_failed:waived:visit-1")).toBe("waived:visit-1");
    expect(alertKind("whatsapp_bridge")).toBe("whatsapp_bridge");
    expect(alertSubject("whatsapp_bridge")).toBe("");
  });
});

describe("the department that acts on an alert", () => {
  it("gives a client's messages, CRM records and requests to Customer Care", () => {
    for (const key of [messageFailedKey("m"), crmLeadKey("l"), crmErasureKey("p"), deletionWaitingKey("d")]) {
      expect(alertDepartment(alertKind(key))).toBe("customer_care");
    }
  });

  it("gives refunds, invoices and Books to Finance, and stock to Operations", () => {
    expect(alertDepartment("cancel_refund_failed")).toBe("finance");
    expect(alertDepartment("invoice_draft")).toBe("finance");
    expect(alertDepartment("books_refund_refused")).toBe("finance");
    expect(alertDepartment("low_stock")).toBe("operations");
  });

  it("gives anything about the system itself, or unknown, to Admin", () => {
    expect(alertDepartment("cron_job")).toBe("admin");
    expect(alertDepartment("whatsapp_bridge")).toBe("admin");
    expect(alertDepartment("constructor")).toBe("admin");
  });
});

describe("what marking an alert done asks", () => {
  it("is Manage for a CRM erasure, which it records as done, and Act for any other", () => {
    expect(markDoneLevel("crm_erasure")).toBe("manage");
    expect(markDoneLevel("message_failed")).toBe("act");
    expect(markDoneLevel("cancel_refund_failed")).toBe("act");
  });
});

describe("what can be sent again", () => {
  it("is a failed message, a lead the CRM gave up on, and an erasure there", () => {
    expect(["message_failed", "crm_lead", "crm_erasure"].every(maySendAgain)).toBe(true);
    expect(maySendAgain("cancel_refund_failed")).toBe(false);
    expect(maySendAgain("deletion_waiting")).toBe(false);
  });
});

describe("how often the chat is told again of an alert still open", () => {
  it("is every six hours when nobody can sign in, or a client has paid and has no visit or no refund", () => {
    for (const kind of ["whatsapp_bridge", "login_codes_failing", "unbooked_hold", "cancel_refund_failed"]) {
      expect(retellAfterHours(kind)).toBe(6);
    }
  });

  it("is every day for any other", () => {
    expect(retellAfterHours("invoice_draft")).toBe(24);
    expect(retellAfterHours("google_refused")).toBe(24);
    expect(retellAfterHours("cron_job")).toBe(24);
  });
});
