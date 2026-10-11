import { beforeEach, describe, expect, it } from "vitest";
import { createCodeSender } from "../../../src/providers/codes.ts";
import { createStubMessaging } from "../../../src/providers/messaging/stub.ts";
import { SMS_URL } from "../../../src/providers/msg91-sms.ts";
import { captureLogs, fakeFetch, json, markDatabase } from "../helpers.ts";
import { log } from "./messaging-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

const sms = { authKey: "msg91-key", templateId: "tmpl-login" };

function senderWith(answer: () => Response) {
  const http = fakeFetch({ [SMS_URL]: answer });
  const codes = createCodeSender("msg91", sms, { messaging: createStubMessaging(log), fetch: http.fetch, log });
  return { http, codes };
}

describe("a login code by SMS through MSG91", () => {
  it("sends the code as the template's one variable, to the number's digits", async () => {
    const { http, codes } = senderWith(() => json({ type: "success", message: "req-1" }));

    const result = await codes.send("sms", "+919810000001", "123456");

    expect(codes.smsAvailable).toBe(true);
    expect(result).toEqual({ ok: true, providerMessageId: "req-1" });
    expect(http.calls[0]?.headers.get("authkey")).toBe("msg91-key");
    expect(JSON.parse(http.calls[0]?.body ?? "{}")).toEqual({
      template_id: "tmpl-login",
      short_url: "0",
      recipients: [{ mobiles: "919810000001", otp: "123456" }],
    });
  });

  it("fails on MSG91's refusal, with its reason and no number in it", async () => {
    const { codes } = senderWith(() => json({ type: "error", message: "Invalid mobile 919810000001" }, 400));

    expect(await codes.send("sms", "+919810000001", "123456")).toEqual({
      ok: false,
      transient: false,
      detail: "HTTP 400 Invalid mobile ############",
    });
  });

  it("takes a 200 that is not a success as a refusal", async () => {
    const { codes } = senderWith(() => json({ type: "error", message: "Template not approved" }));

    expect(await codes.send("sms", "+919810000001", "123456")).toMatchObject({ ok: false, transient: false });
  });

  it("is worth trying again after a 5xx", async () => {
    const { codes } = senderWith(() => json({}, 503));

    expect(await codes.send("sms", "+919810000001", "123456")).toMatchObject({ ok: false, transient: true });
  });
});
