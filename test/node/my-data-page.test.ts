// The readable copy of a client's data export (src/domain/my-data-page.ts): labelled, in India's time, and safe to
// open whatever a client or ops typed.

import { describe, expect, it } from "vitest";
import { myDataPage } from "../../src/domain/my-data-page.ts";

const EXPORTED = new Date("2026-10-04T12:00:00.000Z");

/** The page's text, tags taken out, as a person reads it. */
const read = (page: string) =>
  page
    .replace(/<style>[\s\S]*<\/style>/, "")
    .replace(/<\/(dt|h1|h2|p)>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ");

describe("the readable copy of a client's data", () => {
  const held = {
    person: { name: "Rohit Malhotra", mobile: "+919810000001", email: null, contactable: 1, created_at: "2026-09-21T06:30:00.000Z" },
    consents: [
      {
        purpose: "whatsapp_visits",
        granted: 1,
        notice_version: "whatsapp-visits-booking-v1",
        source: "app_booking",
        created_at: "2026-09-21T06:30:00.000Z",
      },
    ],
    visits: [{ type: "first_fit", window_start: "2026-10-02T04:30:00.000Z", status: "completed", technician: "Imran" }],
    bookings_started: [{ amount: 3_540_000, consents_shown: '["photos_own_record","photos_referral_cards"]' }],
    consultation_requests: [{ requested_date: "2026-10-02", requested_window: "morning" }],
    grievances: [{ text: "<script>alert('hi')</script> & more", state: "open" }],
  };

  it("heads the page with when it was downloaded, in India's time", () => {
    expect(read(myDataPage(held, EXPORTED))).toContain("Downloaded 4 Oct 2026, 5:30 pm, India time.");
  });

  it("gives each field under its label, every time in India's and money in rupees", () => {
    const page = read(myDataPage(held, EXPORTED));
    expect(page).toContain("Your details");
    expect(page).toContain("Name\n Rohit Malhotra");
    expect(page).toContain("With us since\n 21 Sep 2026, 12 pm");
    expect(page).toContain("We may contact you\n Yes");
    expect(page).toContain("Visit\n First fit");
    expect(page).toContain("From\n 2 Oct 2026, 10 am");
    expect(page).toContain("Amount\n Rs. 35,400");
    expect(page).toContain("Day\n 2 Oct 2026");
  });

  it("names each consent by its purpose and the words its notice showed", () => {
    const page = read(myDataPage(held, EXPORTED));
    expect(page).toContain("For\n WhatsApp about your visits");
    expect(page).toContain("What you were shown\n Remind me on WhatsApp the day before");
    expect(page).toContain("Where\n App booking");
    expect(page).toContain("Agreed by booking\n Photographs taken for your visit record, Photographs on referral cards");
  });

  it("leaves an empty field out, and says when a part holds nothing", () => {
    const page = read(myDataPage(held, EXPORTED));
    expect(page).not.toContain("E-mail");
    expect(page).toContain("Changes of number\n Nothing held.");
  });

  it("writes what anyone typed as text, never as markup", () => {
    const page = myDataPage(held, EXPORTED);
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;alert(&#39;hi&#39;)&lt;/script&gt; &amp; more");
  });
});
