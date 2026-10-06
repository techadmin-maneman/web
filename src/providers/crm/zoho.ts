// Zoho CRM v8. Only src/providers/crm/index.ts imports this module. Request shapes
// follow Zoho's v8 docs, recorded in docs/decisions/0012-zoho-sync.md:
//
//   insert  POST /crm/v8/Leads             { data: [record], trigger: [...], lar_id? }
//   update  PUT  /crm/v8/Leads/{id}        { data: [record], trigger: [...] }
//   note    POST /crm/v8/Leads/{id}/Notes  { data: [{ Note_Title, Note_Content }] }
//   find    GET  /crm/v8/Leads/search?criteria=(D1_Person_ID:equals:{id})
//   blank   PUT  /crm/v8/Contacts/{id}     { data: [record], trigger: [] }
//   delete  DELETE /crm/v8/Contacts/{id}   the Contact Books' CRM integration made, once it is blank
//   token   POST https://{accounts}/oauth/v2/token?grant_type=refresh_token&...
//
// "trigger": [] turns workflows off; leaving the key out would run them.

import { z } from "zod";
import { LOSS_EXTENT_NAMES, WINDOW_NAMES } from "../../config/booking.ts";
import { BOOKED_WINDOW_NAMES, CRM_ORG_HAS_REFERRAL_FIELDS, REFERRAL_LEAD_SOURCE } from "../../config/crm.ts";
import type { ZohoSettings } from "../../config/settings.ts";
import type { Plan } from "../../policy/one-visit.ts";

import type { CrmContact, CrmLead, CrmProvider, CrmSyncResult, LeadSource, LeadStatus } from "./index.ts";
import {
  answerOf,
  createZohoRequester,
  readAnswer,
  ZohoError,
  type ZohoAnswer,
  type ZohoRequesterDependencies,
  type ZohoWrite,
} from "../zoho-http.ts";
import { assertStatusAllowed, shouldAssign, shouldRunWorkflows, statusForNewRecord, statusForUpdate } from "./rules.ts";

export const LEAD_SOURCE_NAMES: Readonly<Record<LeadSource, string>> = {
  form: "Booking form",
  waitlist: "Waitlist",
  tryon: "Try-on",
};

type ZohoDependencies = ZohoRequesterDependencies;

/** How Zoho answers a write to an ID it no longer has: a Lead deleted, merged away or converted. */
const GONE_CODES: ReadonlySet<string> = new Set(["INVALID_DATA", "ENTITY_ID_INVALID", "RECORD_NOT_FOUND"]);
const mayBeGone = (error: unknown): boolean =>
  error instanceof ZohoError && (error.status === 404 || GONE_CODES.has(error.code));

export function createZohoCrm(settings: ZohoSettings, deps: ZohoDependencies): CrmProvider {
  async function insert(api: ZohoApi, lead: CrmLead): Promise<CrmSyncResult> {
    const status = statusForNewRecord(lead);
    assertStatusAllowed(lead, status);
    const id = await api.insertLead(recordFor(lead, status, true), {
      assignmentRuleId: shouldAssign(lead) ? settings.larId : null,
      runWorkflows: shouldRunWorkflows(lead),
    });
    return { crmLeadId: id, created: true };
  }

  async function update(api: ZohoApi, id: string, lead: CrmLead): Promise<CrmSyncResult> {
    const status = statusForUpdate(lead);
    assertStatusAllowed(lead, status);
    await api.updateLead(id, recordFor(lead, status, false), { runWorkflows: shouldRunWorkflows(lead) });
    await api.addNote(id, noteFor(lead));
    return { crmLeadId: id, created: false };
  }

  async function erase(api: ZohoApi, id: string): Promise<{ found: boolean }> {
    // Workflows off: nothing should chase, or e-mail about, an erased person.
    await api.updateLead(id, ERASED_RECORD, { runWorkflows: false });
    await api.addNote(id, { title: "Personal data erased", content: "Erased at the person's request." });
    return { found: true };
  }

  /**
   * The person's record, found again by their ID when a write to the one D1
   * kept failed as though the CRM no longer had it (ADR 0050). Throws the
   * write's error when it is not that, or when the search finds the same record.
   */
  async function foundAgain(api: ZohoApi, error: unknown, personId: string, knownId: string | null) {
    if (knownId === null || !mayBeGone(error)) throw error;
    const found = await api.findLeadByPersonId(personId);
    if (found === knownId) throw error;
    deps.log.warn("crm_lead_id_stale", { person_id: personId, found: found !== null });
    return found;
  }

  return {
    async syncLead(lead, knownCrmLeadId) {
      const api = createZohoApi(settings, { ...deps, log: deps.log.child({ lead_id: lead.leadId }) });
      const existingId = knownCrmLeadId ?? (await api.findLeadByPersonId(lead.personId));
      if (existingId === null) return insert(api, lead);
      try {
        return await update(api, existingId, lead);
      } catch (error) {
        const found = await foundAgain(api, error, lead.personId, knownCrmLeadId);
        return found === null ? insert(api, lead) : update(api, found, lead);
      }
    },

    async updateContact(contact, knownCrmLeadId) {
      const api = createZohoApi(settings, { ...deps, log: deps.log.child({ person_id: contact.personId }) });
      const record = contactRecordFor(contact);
      const write = async (id: string) => {
        await api.updateLead(id, record, { runWorkflows: false });
        if (contact.inviteAttached) await api.addNote(id, INVITE_ATTACHED_NOTE);
        return { crmLeadId: id };
      };
      const id = knownCrmLeadId ?? (await api.findLeadByPersonId(contact.personId));
      if (id === null) return { crmLeadId: null };
      try {
        return await write(id);
      } catch (error) {
        const found = await foundAgain(api, error, contact.personId, knownCrmLeadId);
        return found === null ? { crmLeadId: null } : write(found);
      }
    },

    eraseContact: (contactId) =>
      eraseContact(createZohoApi(settings, { ...deps, log: deps.log.child({ crm_contact_id: contactId }) }), contactId),

    async erasePerson(personId, knownCrmLeadId) {
      const api = createZohoApi(settings, { ...deps, log: deps.log.child({ person_id: personId }) });
      const id = knownCrmLeadId ?? (await api.findLeadByPersonId(personId));
      if (id === null) return { found: false };
      try {
        return await erase(api, id);
      } catch (error) {
        const found = await foundAgain(api, error, personId, knownCrmLeadId);
        return found === null ? { found: false } : erase(api, found);
      }
    },
  };
}

/** Blanks the Contact, so the recycle bin keeps no one either, then deletes it; nothing when the CRM has it no more. */
async function eraseContact(api: ZohoApi, contactId: string): Promise<{ found: boolean }> {
  try {
    await api.blankContact(contactId);
  } catch (error) {
    if (mayBeGone(error)) return { found: false };
    throw error;
  }
  await api.deleteContact(contactId);
  return { found: true };
}

/** What an erased person's record keeps: the lead history, without who it was. */
const ERASED_RECORD: Readonly<Record<string, unknown>> = {
  Last_Name: "Erased",
  Mobile: null,
  Email: null,
  Contact_Consent: false,
  Description: null,
};

/**
 * What an erased client's CRM Contact is blanked to before it is deleted, so the recycle bin keeps no one either:
 * every field of the org's Contacts that could say who they were.
 */
const ERASED_CONTACT: Readonly<Record<string, unknown>> = {
  Salutation: null,
  First_Name: null,
  Last_Name: "Erased",
  Email: null,
  Secondary_Email: null,
  Phone: null,
  Home_Phone: null,
  Other_Phone: null,
  Mobile: null,
  Fax: null,
  Assistant: null,
  Asst_Phone: null,
  Date_of_Birth: null,
  Title: null,
  Department: null,
  Skype_ID: null,
  Twitter: null,
  Description: null,
  Email_Opt_Out: true,
  ...blankAddress("Mailing"),
  ...blankAddress("Other"),
};

function blankAddress(which: "Mailing" | "Other"): Record<string, null> {
  const parts = [
    "Street",
    "Flat_House_No_Building_Apartment_Name",
    "City",
    "State",
    "Zip",
    "Country",
    "Latitude",
    "Longitude",
  ];
  return Object.fromEntries(parts.map((part) => [`${which}_${part}`, null]));
}

const PLAN_NAMES: Readonly<Record<Plan, string>> = {
  consultation: "Consultation",
  one_visit: "Consultation and fit in one visit",
};

/** The lead's Description: what the booking asked for, and the discount code given for it. Null where none says. */
function descriptionOf(lead: CrmLead): string | null {
  if (lead.plan === null) return null;
  const code = lead.discountCode === null ? "" : ` Discount code ${lead.discountCode}.`;
  return `${PLAN_NAMES[lead.plan]}.${code}`;
}

/** The source a new record names: a friend's invite, where the org can say so, else the page the lead came from. */
function sourceOf(lead: CrmLead, fields: OrgFields): string {
  if (lead.inviteCode !== null && fields.referral) return REFERRAL_LEAD_SOURCE;
  return LEAD_SOURCE_NAMES[lead.source];
}

/** Which of the fields the org may not have yet it does have (src/config/crm.ts). */
interface OrgFields {
  readonly referral: boolean;
}

/**
 * The note an invite ops attach leaves on the record. A note needs no field of the org's, so the invite reaches the
 * record while the referral fields do not exist, as a new lead's does (noteFor). No code and no name: an erasure
 * keeps a record's notes.
 */
const INVITE_ATTACHED_NOTE = {
  title: "Invite attached",
  content: "Came through a friend's invite, which ops attached by hand.",
} as const;

/** The Zoho Leads fields a change of number, address or invite writes: the invite's only where the org has it. */
export function contactRecordFor(
  contact: CrmContact,
  fields: OrgFields = { referral: CRM_ORG_HAS_REFERRAL_FIELDS },
): Record<string, unknown> {
  const record: Record<string, unknown> = { Mobile: contact.mobileE164 };
  if (contact.city !== null) record.City = contact.city;
  if (fields.referral && contact.inviteCode !== null) record.Referral_Code = contact.inviteCode;
  return record;
}

/** The Zoho Leads fields for this lead. See docs/provisioning.md, step 8, "Zoho", for the custom fields. */
export function recordFor(
  lead: CrmLead,
  status: LeadStatus | null,
  isNew: boolean,
  fields: OrgFields = { referral: CRM_ORG_HAS_REFERRAL_FIELDS },
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    Last_Name: lead.name,
    Mobile: lead.mobileE164,
    Contact_Consent: lead.contactable,
    D1_Person_ID: lead.personId,
    D1_Lead_ID: lead.leadId,
  };
  if (status !== null) record.Lead_Status = status;
  if (isNew) record.Lead_Source = sourceOf(lead, fields);
  // An invited friend, and the window a booking asked for (ADR 0060: "Marketing sees the person, the
  // source, the day and the invite").
  if (fields.referral && lead.inviteCode !== null) record.Referral_Code = lead.inviteCode;
  if (fields.referral && lead.askedWindow !== null) record.Booked_Window = BOOKED_WINDOW_NAMES[lead.askedWindow];
  if (lead.email !== null) record.Email = lead.email;
  if (lead.tryOn) record.Try_On = true;
  if (lead.utmSource !== null) record.UTM_Source = lead.utmSource;
  if (lead.utmCampaign !== null) record.UTM_Campaign = lead.utmCampaign;

  // Booking details come only from bookings; a try-on must not blank them.
  if (lead.source !== "tryon") {
    const description = descriptionOf(lead);
    if (description !== null) record.Description = description;
    if (lead.city !== null) record.City = lead.city;
    if (lead.firstChoiceWindow !== null) record.First_Choice_Window = WINDOW_NAMES[lead.firstChoiceWindow];
    if (lead.lossExtent !== null) record.Loss_Extent = LOSS_EXTENT_NAMES[lead.lossExtent];
    if (lead.proposedVisitDate !== null) record.Proposed_Visit_Date = lead.proposedVisitDate;
  }
  return record;
}

/** The window a booking asked for, in the note's words: the first form's own choice, else the window booked. */
function windowWords(lead: CrmLead): string | null {
  if (lead.firstChoiceWindow !== null) return WINDOW_NAMES[lead.firstChoiceWindow].toLowerCase();
  return lead.askedWindow;
}

/**
 * The note added to an existing record. City, dates, windows and the plan only; no personal data, and no code, since
 * an erasure keeps a record's notes. A note needs no field of the org's, so the invite and the window reach a record
 * here whether or not the referral fields exist.
 */
export function noteFor(lead: CrmLead): { title: string; content: string } {
  if (lead.source === "form") {
    const asked = windowWords(lead);
    const window = asked === null ? "" : `, ${asked}`;
    const date = lead.proposedVisitDate === null ? "" : `, proposed ${lead.proposedVisitDate}`;
    const plan = lead.plan === "one_visit" ? ` ${PLAN_NAMES.one_visit}.` : "";
    const invite = lead.inviteCode === null ? "" : " Came through an invite.";
    return {
      title: "New booking request",
      content: `Asked for a visit in ${lead.city ?? "an unknown city"}${window}${date}.${plan}${invite}`,
    };
  }
  if (lead.source === "waitlist") {
    return { title: "Joined a waitlist", content: `Asked to be told when ${lead.city ?? "their city"} is served.` };
  }
  return { title: "Used the try-on", content: "Generated a simulation and asked for a copy on WhatsApp." };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type Step = "search" | "insert" | "update" | "note" | "blank_contact" | "delete_contact";

/** Zoho answers per record inside `data`, under a 200 even when the record failed. */
const RecordOutcomes = z.object({
  data: z.array(
    z.object({
      status: z.string().nullish(),
      code: z.string().nullish(),
      message: z.string().nullish(),
      details: z.object({ id: z.string().nullish() }).nullish(),
    }),
  ),
});

/** What a search answers; nothing at all, a 204, when it finds no one. */
const SearchAnswer = z.object({ data: z.array(z.object({ id: z.string() })).default([]) });

type ZohoApi = ReturnType<typeof createZohoApi>;

/** The CRM's one read on its own, finding a person's Lead by their person ID, for a caller that must never write. */
export function createZohoLeadFinder(
  settings: ZohoSettings,
  deps: ZohoDependencies,
): (personId: string) => Promise<string | null> {
  const api = createZohoApi(settings, deps);
  return (personId) => api.findLeadByPersonId(personId);
}

function createZohoApi(settings: ZohoSettings, deps: ZohoDependencies) {
  const request = createZohoRequester("crm", settings, deps);

  /** One API call's answer: its JSON, or null for Zoho's empty 204. */
  async function call(step: Step, path: string, write?: ZohoWrite): Promise<ZohoAnswer> {
    return answerOf(step, await request(step, path, write));
  }

  /** The first record's outcome is ours. */
  function firstRecord(answer: ZohoAnswer): { id: string } {
    const outcomes = RecordOutcomes.safeParse(answer.body);
    const record = outcomes.success ? outcomes.data.data[0] : undefined;
    const id = record?.details?.id;
    if (record?.status !== "success" || id === null || id === undefined) {
      throw new ZohoError(200, record?.code ?? "UNKNOWN", record?.message ?? "no record in the response");
    }
    return { id };
  }

  return {
    async findLeadByPersonId(personId: string): Promise<string | null> {
      const criteria = encodeURIComponent(`(D1_Person_ID:equals:${personId})`);
      const answer = await call("search", `/crm/v8/Leads/search?criteria=${criteria}`);
      if (answer.body === null) return null;
      return readAnswer(answer, SearchAnswer).data[0]?.id ?? null;
    },

    async insertLead(
      record: Record<string, unknown>,
      options: { assignmentRuleId: string | null; runWorkflows: boolean },
    ): Promise<string> {
      const body: Record<string, unknown> = { data: [record], trigger: options.runWorkflows ? ["workflow"] : [] };
      if (options.assignmentRuleId !== null) body.lar_id = options.assignmentRuleId;
      return firstRecord(await call("insert", "/crm/v8/Leads", { method: "POST", body })).id;
    },

    async updateLead(id: string, record: Record<string, unknown>, options: { runWorkflows: boolean }): Promise<void> {
      const body = { data: [record], trigger: options.runWorkflows ? ["workflow"] : [] };
      firstRecord(await call("update", `/crm/v8/Leads/${id}`, { method: "PUT", body }));
    },

    async blankContact(id: string): Promise<void> {
      // Workflows off: nothing should chase, or e-mail about, an erased person.
      const body = { data: [ERASED_CONTACT], trigger: [] };
      firstRecord(await call("blank_contact", `/crm/v8/Contacts/${id}`, { method: "PUT", body }));
    },

    async deleteContact(id: string): Promise<void> {
      firstRecord(await call("delete_contact", `/crm/v8/Contacts/${id}`, { method: "DELETE" }));
    },

    async addNote(id: string, note: { title: string; content: string }): Promise<void> {
      const body = { data: [{ Note_Title: note.title, Note_Content: note.content }] };
      firstRecord(await call("note", `/crm/v8/Leads/${id}/Notes`, { method: "POST", body }));
    },
  };
}
