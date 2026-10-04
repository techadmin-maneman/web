// The readable copy of a client's data export (GET /api/me/export.html; src/domain/my-data-page.ts): each part's
// heading, in the order the page shows them, and each field's label and how its value reads.

/**
 * How a value reads. `time`: an instant, as India's date and clock. `day`: a date. `money`: paise, as rupees.
 * `yesNo`: 1 or 0. `words`: a stored code, as words ("first_fit" reads "First fit"). `purpose`: a consent's purpose.
 * `purposes`: a JSON list of them. `notice`: a notice's version, as the words it showed.
 */
export type FieldKind = "text" | "time" | "day" | "money" | "yesNo" | "words" | "purpose" | "purposes" | "notice";

export interface Field {
  readonly label: string;
  readonly as: FieldKind;
}

export interface Part {
  readonly title: string;
  readonly fields: Readonly<Record<string, Field>>;
}

const text = (label: string): Field => ({ label, as: "text" });
const time = (label: string): Field => ({ label, as: "time" });
const day = (label: string): Field => ({ label, as: "day" });
const money = (label: string): Field => ({ label, as: "money" });
const yesNo = (label: string): Field => ({ label, as: "yesNo" });
const words = (label: string): Field => ({ label, as: "words" });

// No design draws the readable copy of a client's data; every word here is ours.
export const MY_DATA = {
  title: "Everything Mane Man holds about you",
  downloaded: (when: string) => `Downloaded ${when}, India time.`,
  photos: "Your visit photographs are not in this file. See them in the app, under Photos.",
  none: "Nothing held.",
  /** A consent's purpose, as the app's profile names it. */
  purposes: {
    contact: "Contact about your booking",
    tryon_photo: "Your photograph, for a try-on",
    result_delivery: "Your try-on, sent on WhatsApp",
    photos_own_record: "Photographs taken for your visit record",
    photos_referral_cards: "Photographs on referral cards",
    photos_marketing: "Photographs in our marketing",
    whatsapp_visits: "WhatsApp about your visits",
    whatsapp_launches: "WhatsApp about launches",
  } satisfies Readonly<Record<string, string>>,
  /** Stored codes that read badly spaced out; every other code reads as its words. */
  codes: {
    client: "You",
    ops: "Our team",
    system: "Automatically",
    whatsapp_stop: "A STOP reply on WhatsApp",
    message_link: "The link in a message",
    app_share_sheet: "Sharing from the app",
    referral_landing: "An invite's page",
    site_waitlist: "The site's waitlist",
    try_on: "Try-on",
    lapsed: "Paid after the slot's hold ran out",
    not_movable: "The visit had begun, or its technician or time had changed, so it could not be moved",
  } satisfies Readonly<Record<string, string>>,
  parts: {
    person: {
      title: "Your details",
      fields: {
        name: text("Name"),
        mobile: text("Mobile"),
        email: text("E-mail"),
        contactable: yesNo("We may contact you"),
        created_at: time("With us since"),
      },
    },
    addresses: {
      title: "Your addresses",
      fields: {
        flat: text("Flat"),
        floor: text("Floor"),
        tower: text("Tower"),
        building: text("Building"),
        line1: text("Street"),
        line2: text("Street, second line"),
        landmark: text("Landmark"),
        locality: text("Area"),
        city: text("City"),
        pincode: text("Pincode"),
        access_notes: text("Notes for the technician"),
        lat: text("Map pin, latitude"),
        lng: text("Map pin, longitude"),
        given_on_the_phone: yesNo("Given to us on the phone"),
        created_at: time("Added"),
        replaced_at: time("Replaced"),
      },
    },
    consents: {
      title: "What you agreed to",
      fields: {
        purpose: { label: "For", as: "purpose" },
        granted: yesNo("Agreed"),
        notice_version: { label: "What you were shown", as: "notice" },
        source: words("Where"),
        created_at: time("When"),
      },
    },
    visits: {
      title: "Your visits",
      fields: {
        type: words("Visit"),
        tier: words("Hair system"),
        window_start: time("From"),
        window_end: time("Until"),
        status: words("Status"),
        one_visit: yesNo("Consultation and fit in one visit"),
        asked_window: words("Window you asked for"),
        technician: text("Technician"),
        service_city: text("City"),
        service_pincode: text("Pincode"),
        client_note: text("Your note for the technician"),
        client_note_at: time("Note written"),
      },
    },
    visit_changes: {
      title: "Visits moved or cancelled",
      fields: {
        kind: words("Change"),
        was_start: time("Was"),
        now_start: time("Now"),
        notice: words("Notice"),
        ops_terms: words("Cancelled by us, on terms"),
        refund_amount: money("Refunded"),
        kept_amount: money("Kept"),
        created_at: time("When"),
      },
    },
    bookings_started: {
      title: "Bookings you started",
      fields: {
        reference: text("Reference"),
        type: words("Visit"),
        tier: words("Hair system"),
        minutes: text("Minutes"),
        date: day("Day"),
        window_label: words("Window"),
        pincode: text("Pincode"),
        move_kind: words("Moving a visit"),
        one_visit: yesNo("Consultation and fit in one visit"),
        amount: money("Amount"),
        use_credit: yesNo("Paid with a credit"),
        pay_by_link: yesNo("Paid by link"),
        change_notice_hours: text("Hours' notice to change it free"),
        late_change_charge: words("Charge for a late change"),
        no_show_charge: words("Charge if you are not home"),
        consents_shown: { label: "Agreed by booking", as: "purposes" },
        state: words("Status"),
        auto_refund_reason: words("Refunded automatically"),
        created_at: time("Started"),
        confirmed_at: time("Confirmed"),
      },
    },
    hair_profile: {
      title: "Your hair profile",
      fields: {
        recorded_at: time("Recorded"),
        recorded_by: words("Recorded by"),
        norwood_stage: text("Norwood stage"),
        head_circumference_cm: text("Head circumference, cm"),
        front_to_nape_cm: text("Front to nape, cm"),
        ear_to_ear_cm: text("Ear to ear, cm"),
        temple_to_temple_cm: text("Temple to temple, cm"),
        base_width_in: text("Base width, inches"),
        base_length_in: text("Base length, inches"),
        colour: text("Colour"),
        grey_percent: text("Grey, %"),
        density_percent: text("Density, %"),
        wave: words("Wave"),
        hairline: words("Hairline"),
        product: words("Hair system"),
        product_name: text("Hair system, by name"),
        attachment: words("Attachment"),
        remedies: words("Tried before"),
        transplant_year: text("Transplant year"),
        skin_and_allergies: text("Skin and allergies"),
      },
    },
    hair_systems: {
      title: "Your hair systems",
      fields: {
        piece_code: text("Hair system"),
        base: words("Base"),
        fitted_at: day("Fitted"),
        replacement_due_at: day("Replacement due"),
        failed_at: day("Failed"),
        failure_reason: text("Why it failed"),
      },
    },
    payments: {
      title: "Payments",
      fields: {
        reference: text("Reference"),
        kind: words("For"),
        amount: money("Amount"),
        amount_ex_gst: money("Before GST"),
        gst_percent: text("GST, %"),
        method: words("Paid by"),
        card_network: words("Card"),
        status: words("Status"),
        refunded_amount: money("Refunded"),
        created_at: time("Started"),
        captured_at: time("Paid"),
      },
    },
    refunds: {
      title: "Refunds",
      fields: {
        payment: text("Of payment"),
        amount: money("Amount"),
        status: words("Status"),
        created_at: time("Asked for"),
        processed_at: time("Sent"),
      },
    },
    discount_codes: {
      title: "Discount codes",
      fields: {
        code: text("Code"),
        amount_off: money("Took off, before GST"),
        given_by: words("Entered by"),
        created_at: time("Entered"),
        removed_at: time("Taken off"),
        removed_by: words("Taken off by"),
      },
    },
    credits: {
      title: "Visit credits",
      fields: {
        kind: words("Entry"),
        visits: text("Visits"),
        expires_at: time("Expires"),
        created_at: time("When"),
      },
    },
    no_show_disputes: {
      title: "Charges you disputed",
      fields: {
        visit: time("Visit"),
        reason: text("Your reason"),
        created_at: time("Disputed"),
        ruling: words("Our ruling"),
        ruled_at: time("Ruled"),
      },
    },
    referral: {
      title: "Your invite",
      fields: {
        code: text("Code"),
        card_state: words("Card"),
        opens: text("Times opened"),
        created_at: time("Made"),
      },
    },
    referred_by: {
      title: "The invite that brought you",
      fields: {
        code: text("Code"),
        via: words("Through"),
        first_touch_at: time("First opened"),
        pincode: text("Pincode"),
        friend_first_name: text("Your first name, as your friend sees it"),
        told_notice: { label: "What you were told", as: "notice" },
        grant_state: words("Reward"),
        friend_visits: text("Free visits for you"),
        credit_valid_days: text("Days they last"),
        created_at: time("When"),
      },
    },
    consultation_requests: {
      title: "Consultations you asked for",
      fields: {
        pincode: text("Pincode"),
        requested_date: day("Day"),
        requested_window: words("Window"),
        one_visit: yesNo("Consultation and fit in one visit"),
        referral_code: text("Invite code"),
        discount_code: text("Discount code"),
        booked: yesNo("Booked"),
        created_at: time("Asked"),
      },
    },
    first_fit_requests: {
      title: "First fits you asked for",
      fields: {
        preferred_window: words("Window"),
        created_at: time("Asked"),
      },
    },
    waitlist: {
      title: "Waiting for your area",
      fields: {
        pincode: text("Pincode"),
        referral_code: text("Invite code"),
        contact_consent_at: time("Agreed to hear when we arrive"),
        launch_alert: yesNo("Tell you when we launch"),
        alerted_at: time("Told"),
        created_at: time("Joined"),
      },
    },
    leads: {
      title: "How you reached us",
      fields: {
        source: words("Through"),
        city: text("City"),
        loss_extent: words("Hair loss"),
        first_choice_window: words("Window you asked for"),
        proposed_visit_date: day("Day you asked for"),
        referrer: text("Page you came from"),
        landing_path: text("Page you landed on"),
        utm_source: text("Campaign source"),
        utm_medium: text("Campaign medium"),
        utm_campaign: text("Campaign"),
        utm_content: text("Campaign content"),
        gclid: text("Google ad click"),
        fbclid: text("Facebook ad click"),
        created_at: time("When"),
      },
    },
    try_ons: {
      title: "Your try-ons",
      fields: {
        stage: words("Hair loss"),
        preset: words("Look"),
        hair_color: words("Colour"),
        state: words("Status"),
        photo_consent_version: { label: "What you were shown", as: "notice" },
        photo_consent_at: time("Agreed"),
        kept_at: time("Kept in the app"),
        upload_deleted_at: time("Your photograph deleted"),
        created_at: time("When"),
      },
    },
    messages: {
      title: "WhatsApp messages we sent you",
      fields: {
        kind: words("Message"),
        state: words("Status"),
        created_at: time("Written"),
        sent_at: time("Sent"),
        delivered_at: time("Delivered"),
        read_at: time("Read"),
      },
    },
    grievances: {
      title: "Concerns you raised",
      fields: {
        text: text("Your words"),
        state: words("Status"),
        response: text("Our answer"),
        resolved_at: time("Answered"),
        created_at: time("Raised"),
      },
    },
    number_changes: {
      title: "Changes of number",
      fields: {
        new_mobile_e164: text("New number"),
        replaced_mobile_e164: text("Number replaced"),
        state: words("Status"),
        old_verified_at: time("Old number proven"),
        new_verified_at: time("New number proven"),
        decided_at: time("Decided"),
        reason: text("Our reason"),
        created_at: time("Asked"),
      },
    },
    deletion_requests: {
      title: "Requests to delete your account",
      fields: {
        state: words("Status"),
        decided_at: time("Decided"),
        reason: text("Our reason"),
        created_at: time("Asked"),
      },
    },
    sessions: {
      title: "Where you signed in",
      fields: {
        device_label: text("Device"),
        created_at: time("Signed in"),
        last_seen_at: time("Last used"),
        expires_at: time("Ends"),
        revoked_at: time("Ended"),
      },
    },
    photo_views: {
      title: "Who in our team opened your photographs",
      fields: {
        by: text("Who"),
        at: time("When"),
      },
    },
  } satisfies Readonly<Record<string, Part>>,
};
