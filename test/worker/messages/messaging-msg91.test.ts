import { beforeEach, describe, expect, it } from "vitest";
import { createMsg91Messaging, SEND_URL } from "../../../src/providers/messaging/msg91.ts";
import type { MessagingProvider } from "../../../src/providers/messaging/index.ts";
import { captureLogs, fakeFetch, json, markDatabase } from "../helpers.ts";
import { log } from "./messaging-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

const settings = { authKey: "msg91-key", integratedNumber: "919800000000" };

/** The one template send of `http`'s first call: its template, and the components of its one recipient. */
function sent(http: ReturnType<typeof fakeFetch>) {
  const body = JSON.parse(http.calls[0]?.body ?? "{}") as {
    integrated_number: string;
    content_type: string;
    payload: {
      template: {
        name: string;
        language: { code: string };
        to_and_components: { to: string[]; components: Record<string, unknown> }[];
      };
    };
  };
  const [recipient] = body.payload.template.to_and_components;
  return { body, template: body.payload.template, to: recipient?.to, components: recipient?.components };
}

describe("MSG91", () => {
  const accepted = () => json({ hasError: false, status: "success", request_id: "req-1" });

  it("sends an approved template from the business number, its variables renumbered in the order the text uses them", async () => {
    const http = fakeFetch({ [SEND_URL]: accepted });
    const msg91 = createMsg91Messaging(settings, { fetch: http.fetch, log });

    // "Hi {{1}}, {{5}} is at your door for your {{2}}." is approved as "Hi {{1}}, {{2}} is at your door for your {{3}}."
    const result = await msg91.send({
      to: "+919810000001",
      template: "technician_arrived_v1",
      params: ["Arjun", "service visit", "Thu 24 Sep", "12 to 4 pm", "Imran"],
    });

    expect(result).toEqual({ ok: true, providerMessageId: "req-1" });
    expect(http.calls[0]?.headers.get("authkey")).toBe("msg91-key");
    const { body, template, to, components } = sent(http);
    expect(body).toMatchObject({ integrated_number: "919800000000", content_type: "template" });
    expect(template).toMatchObject({ name: "technician_arrived_v1", language: { code: "en" } });
    expect(to).toEqual(["919810000001"]);
    expect(components).toEqual({
      body_1: { type: "text", value: "Arjun" },
      body_2: { type: "text", value: "Imran" },
      body_3: { type: "text", value: "service visit" },
    });
  });

  it("sends a login code as an authentication template, the code also behind its copy button", async () => {
    const http = fakeFetch({ [SEND_URL]: accepted });
    const msg91 = createMsg91Messaging(settings, { fetch: http.fetch, log });
    await msg91.send({ to: "+919810000001", template: "login_code_v1", params: ["482913"] });
    expect(sent(http).components).toEqual({
      body_1: { type: "text", value: "482913" },
      button_1: { subtype: "url", type: "text", value: "482913" },
    });
  });

  it("puts the try-on's look above the text, and the stop link behind a reminder's button", async () => {
    const http = fakeFetch({ [SEND_URL]: accepted });
    const msg91 = createMsg91Messaging(settings, { fetch: http.fetch, log });
    await msg91.send({
      to: "+919810000001",
      template: "tryon_result_v1",
      params: ["Arjun", "https://maneman.in/book"],
      media: { url: "https://x.test/r.png", type: "image/png" },
    });
    await msg91.send({
      to: "+919810000001",
      template: "next_visit_due_v1",
      params: ["Arjun", "service visit", "Thu 24 Sep"],
      stopLink: "https://maneman.in/stop#a1b2c3",
    });
    expect(sent(http).components).toEqual({
      body_1: { type: "text", value: "Arjun" },
      header_1: { type: "image", value: "https://x.test/r.png" },
      button_1: { subtype: "url", type: "text", value: "book" },
    });
    const reminder = JSON.parse(http.calls[1]?.body ?? "{}") as {
      payload: { template: { to_and_components: { components: Record<string, unknown> }[] } };
    };
    expect(reminder.payload.template.to_and_components[0]?.components).toMatchObject({
      button_1: { subtype: "url", type: "text", value: "stop#a1b2c3" },
    });
  });

  it("refuses without calling out a send missing what its template takes", async () => {
    const http = fakeFetch({ [SEND_URL]: accepted });
    const msg91: MessagingProvider = createMsg91Messaging(settings, { fetch: http.fetch, log });
    const missingParam = await msg91.send({ to: "+919810000001", template: "tryon_result_v1", params: ["Arjun"] });
    const missingImage = await msg91.send({
      to: "+919810000001",
      template: "tryon_result_v1",
      params: ["Arjun", "https://maneman.in/book"],
    });
    const missingStopLink = await msg91.send({
      to: "+919810000001",
      template: "visit_reminder_v1",
      params: ["Arjun", "service visit", "Thu 24 Sep", "12 to 4 pm", "Imran"],
    });
    for (const result of [missingParam, missingImage, missingStopLink]) {
      expect(result).toMatchObject({ ok: false, transient: false });
    }
    expect(http.calls).toHaveLength(0);
  });

  it("waits on a refused key, tries again after a 5xx, and gives up on a refused template", async () => {
    const send = async (answer: () => Response) => {
      const http = fakeFetch({ [SEND_URL]: answer });
      return createMsg91Messaging(settings, { fetch: http.fetch, log }).send({
        to: "+919810000001",
        template: "visit_moved_v1",
        params: ["Arjun", "service visit", "Thu 24 Sep", "12 to 4 pm", "Imran"],
      });
    };
    expect(await send(() => json({ message: "Unauthorized" }, 401))).toMatchObject({
      ok: false,
      bridgeDown: true,
    });
    expect(await send(() => json({ message: "Server error" }, 503))).toMatchObject({ ok: false, transient: true });
    expect(await send(() => json({ hasError: true, errors: "Template not approved for 919810000001" }))).toEqual({
      ok: false,
      transient: false,
      detail: "HTTP 200 Template not approved for ############",
    });
  });

  it("has nothing to keep open, so it is always reachable", async () => {
    const http = fakeFetch({});
    expect(await createMsg91Messaging(settings, { fetch: http.fetch, log }).connection()).toEqual({ open: true });
    expect(http.calls).toHaveLength(0);
  });
});
