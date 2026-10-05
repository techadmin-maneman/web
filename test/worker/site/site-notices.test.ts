// What the site's booking form tells a number we already know, on WhatsApp rather than on the page, which gives every
// number the same answer (src/domain/site-notices.ts). Each is written as things stand when the consumer sends it.
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../../src/config/message-templates.ts";
import { createLogger } from "../../../src/log.ts";
import type { MessagingProvider } from "../../../src/providers/messaging/index.ts";
import { sendMessage } from "../../../src/queues/messaging.ts";
import { captureLogs, fakeDependencies, LOCAL_CONFIG, markDatabase, NOW } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";

const log = createLogger();

function recordingProvider() {
  const sent: string[] = [];
  const provider: MessagingProvider = {
    send: ({ template, params }) => {
      sent.push(renderMessage(template, params) ?? `unknown template ${template}`);
      return Promise.resolve({ ok: true, providerMessageId: "wa-1" });
    },
    connection: () => Promise.resolve({ open: true }),
  };
  return { provider, sent };
}

async function consentToVisitMessages() {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, 'whatsapp_visits', 'test-notice', 1, ?3)`,
  )
    .bind(crypto.randomUUID(), PERSON, NOW.toISOString())
    .run();
}

async function appointment(type: string, status: string, windowStart: string, windowEnd: string) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'Scheduled', ?6, ?7, ?8, ?8)`,
  )
    .bind(crypto.randomUUID(), crypto.randomUUID(), PERSON, type, status, windowStart, windowEnd, NOW.toISOString())
    .run();
}

/** Karan's consultation, on Wednesday 23 September in the morning. */
const consultationToCome = () =>
  appointment("consultation", "scheduled", "2026-09-23T03:30:00.000Z", "2026-09-23T04:30:00.000Z");
const fitted = () => appointment("first_fit", "completed", "2026-08-01T03:30:00.000Z", "2026-08-01T06:30:00.000Z");

async function queued(kind: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
     VALUES (?1, ?2, ?3, ?4, 'person', ?3, 'queued', ?2)`,
  )
    .bind(id, NOW.toISOString(), PERSON, kind)
    .run();
  return id;
}

/** Sends one queued notice; what Karan read, or why nothing went. */
async function send(kind: string): Promise<{ text: string | null; skipped: string | null }> {
  const messageId = await queued(kind);
  const { provider, sent } = recordingProvider();
  await sendMessage(env.DB, LOCAL_CONFIG, fakeDependencies({ messaging: provider }), log, messageId);
  const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages WHERE id = ?1")
    .bind(messageId)
    .first<{ state: string; last_error: string | null }>();
  return { text: sent[0] ?? null, skipped: row?.state === "skipped" ? row.last_error : null };
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000002', 'Karan Bhatia')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

describe("a consultation still to happen", () => {
  it("is named with its day and window, privately, to the number", async () => {
    await consentToVisitMessages();
    await consultationToCome();
    expect((await send("consultation_exists")).text).toBe(
      "Hi Karan, this number was just used to book on our site. Your consultation is already booked for Wed 23 Sep, 9 am to 12 pm, so we haven't booked another. See or move it in the Mane Man app.",
    );
  });

  it("is named the consultation and fit when it is the two in one visit", async () => {
    await consentToVisitMessages();
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         fsm_modified_at, synced_at, one_visit)
       VALUES ('one-visit', 'fsm-one-visit', ?1, 'first_fit', 'scheduled', 'Scheduled', '2026-09-23T03:30:00.000Z',
         '2026-09-23T06:30:00.000Z', ?2, ?2, 'booked')`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    expect((await send("consultation_exists")).text).toContain(
      "Your consultation and fit is already booked for Wed 23 Sep, 9 am to 12 pm",
    );
  });

  it("is named the consultation alone when a first fit is booked for another day", async () => {
    await consentToVisitMessages();
    await consultationToCome();
    await appointment("first_fit", "scheduled", "2026-09-30T03:30:00.000Z", "2026-09-30T06:30:00.000Z");
    expect((await send("consultation_exists")).text).toContain(
      "Your consultation is already booked for Wed 23 Sep, 9 am to 12 pm",
    );
  });

  it("is not sent once the consultation has gone", async () => {
    await consentToVisitMessages();
    expect(await send("consultation_exists")).toEqual({ text: null, skipped: "no consultation still to happen" });
  });

  it("is not sent to a number that never agreed to WhatsApp about visits", async () => {
    await consultationToCome();
    expect(await send("consultation_exists")).toEqual({
      text: null,
      skipped: "no consent to WhatsApp about visits",
    });
  });
});

describe("a client past consultations", () => {
  it("is told to book in the app", async () => {
    await consentToVisitMessages();
    await fitted();
    expect((await send("book_in_app")).text).toBe(
      "Hi Karan, this number was just used to book on our site. As a Mane Man client, you book in the Mane Man app. Sign in with this number.",
    );
  });

  it("is told nothing by the time a consultation may be booked from the site again", async () => {
    await consentToVisitMessages();
    expect(await send("book_in_app")).toEqual({ text: null, skipped: "may book from the site now" });
  });
});

describe("an address already on the account", () => {
  it("is where the visit goes, which the number is told without the address itself", async () => {
    await consentToVisitMessages();
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES ('old', ?1, '2026-09-01T00:00:00.000Z', 'House 12', 'Sector 45', 'Gurgaon', '122018')`,
    )
      .bind(PERSON)
      .run();
    const { text } = await send("address_on_account");
    expect(text).toBe(
      "Hi Karan, we'll come to the address on your account, not the one typed on our site. Change it in the Mane Man app.",
    );
    expect(text).not.toContain("House 12");
  });

  it("is not mentioned when the account has none", async () => {
    await consentToVisitMessages();
    expect(await send("address_on_account")).toEqual({ text: null, skipped: "no address on the account" });
  });
});

// The visit goes to the address on the account, so where we do not come to it nothing is booked.
describe("an address on the account in a pincode we do not come to", () => {
  beforeEach(async () => {
    await consentToVisitMessages();
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES ('old', ?1, '2026-09-01T00:00:00.000Z', 'House 12', 'Bandra West', 'Mumbai', '400050')`,
    )
      .bind(PERSON)
      .run();
  });

  it("is why nothing was booked, which the number is told with its pincode alone", async () => {
    const { text } = await send("address_not_served");
    expect(text).toBe(
      "Hi Karan, this number was just used to book on our site. The address on your account is at pincode 400050, which we don't cover yet, so nothing was booked. If you've moved, change your address in the Mane Man app and book there.",
    );
    expect(text).not.toContain("House 12");
  });

  it("is not mentioned once we come there", async () => {
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('400050', 'Bandra', 'Mumbai', 1)",
    ).run();
    expect(await send("address_not_served")).toEqual({
      text: null,
      skipped: "we come to the address on the account now",
    });
  });
});
