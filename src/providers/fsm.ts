// Zoho FSM, the system of record for field work, behind an interface
// (docs/decisions/0032-fsm-mirror.md). Callers use FsmProvider; only this file
// knows which implementation runs, and only src/providers/fsm-zoho.ts knows
// FSM's API. Reads feed the D1 mirror. The only writes so far put a booked
// lead into FSM, as a contact and a Request for ops to schedule.

import type { ZohoFsmSettings } from "../config/settings.ts";
import { FSM_BASE_PART_NAME, FSM_SERVICE_NAMES } from "../config/visit-types.ts";
import type { Logger } from "../log.ts";
import { createZohoFsm } from "./fsm-zoho.ts";

/** An appointment as FSM holds it, in our words. Times are ISO 8601 with India's offset. */
export interface FsmAppointment {
  readonly id: string;
  /** FSM's own label, e.g. "AP-3". */
  readonly name: string;
  /** FSM's status word: Scheduled, Dispatched, In Progress, Completed, Cancelled or Terminated. */
  readonly status: string;
  readonly workOrderId: string | null;
  readonly contactId: string | null;
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  /** The service resources (technicians) assigned, lead first. */
  readonly technicianIds: readonly string[];
  /** The service items its line items are for: the visit type comes from these. */
  readonly serviceIds: readonly string[];
  /** Where the visit is: the service address's city and pincode, as FSM holds them. */
  readonly serviceCity: string | null;
  readonly servicePincode: string | null;
  /** The Books invoice, once one is raised. */
  readonly invoiceId: string | null;
  readonly modifiedAt: string;
}

export interface FsmContact {
  readonly id: string;
  readonly name: string;
  /** As FSM holds it; the mirror turns it into E.164. */
  readonly mobile: string | null;
  readonly email: string | null;
}

/** A service resource: the technician FSM assigns appointments to. */
export interface FsmTechnician {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly active: boolean;
}

/** A service or a part in FSM's catalogue. */
export interface FsmItem {
  readonly id: string;
  readonly name: string;
  readonly type: "Service" | "Part";
}

export interface FsmAttachment {
  readonly id: string;
  /** What `download` takes. */
  readonly fileId: string;
  readonly name: string;
  readonly size: number;
  readonly createdAt: string;
}

export interface FsmDownload {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
}

/** A person to add to FSM as a contact. Their full address is confirmed with them later; FSM holds the city. */
export interface NewFsmContact {
  readonly firstName: string | null;
  readonly lastName: string;
  /** E.164, as the mirror matches it. */
  readonly mobile: string;
  readonly email: string | null;
  readonly city: string;
  /** The state, e.g. Haryana, and its GST code, e.g. HR; null where the city is not one we know. */
  readonly state: string | null;
  readonly stateCode: string | null;
}

/** A visit a client asked for, for ops to schedule in FSM: a Request. */
export interface NewFsmRequest {
  readonly contactId: string;
  readonly summary: string;
  /** The service item asked for, e.g. the Consultation. */
  readonly serviceId: string;
  /** YYYY-MM-DD, the day the client asked for, if any. */
  readonly preferredDate: string | null;
  /** The window they asked for, in words. */
  readonly preferenceNote: string;
}

export interface FsmProvider {
  appointment(id: string): Promise<FsmAppointment | null>;
  /** One page of appointments, most recently changed first, for the reconciliation. */
  appointments(page: number, perPage: number): Promise<{ appointments: FsmAppointment[]; more: boolean }>;
  contact(id: string): Promise<FsmContact | null>;
  technicians(): Promise<FsmTechnician[]>;
  items(): Promise<FsmItem[]>;
  /** The files attached to an appointment, such as its photographs. */
  attachments(appointmentId: string): Promise<FsmAttachment[]>;
  download(fileId: string): Promise<FsmDownload>;
  /** Adds a contact, with a service address in their city; returns its FSM ID. */
  createContact(contact: NewFsmContact): Promise<string>;
  /** Adds a Request against a contact's service address; returns its FSM ID. */
  createRequest(request: NewFsmRequest): Promise<string>;
}

export function createFsmProvider(
  provider: string | undefined,
  settings: ZohoFsmSettings | null,
  deps: { db: D1Database; fetch: typeof fetch; now: () => Date; log: Logger },
): FsmProvider {
  if (provider === "zoho" && settings !== null) return createZohoFsm(settings, deps);
  if (provider === "stub") return createStubFsm({ ...EMPTY_FSM, items: CATALOGUE });
  return createUnconnectedFsm();
}

/** What a stub FSM holds: records by their FSM IDs, and files by file ID. */
export interface StubFsmWorld {
  readonly appointments: FsmAppointment[];
  readonly contacts: FsmContact[];
  readonly technicians: FsmTechnician[];
  readonly items: FsmItem[];
  readonly attachments: Record<string, FsmAttachment[]>;
  readonly files: Record<string, { bytes: Uint8Array; contentType: string }>;
}

/** The catalogue scripts/setup-fsm.ts makes in FSM, which the local stub holds, so local bookings reach it. */
const CATALOGUE: FsmItem[] = [
  ...Object.values(FSM_SERVICE_NAMES).map((name, index) => ({
    id: `stub-service-${String(index + 1)}`,
    name,
    type: "Service" as const,
  })),
  { id: "stub-part-1", name: FSM_BASE_PART_NAME, type: "Part" },
];

export const EMPTY_FSM: StubFsmWorld = {
  appointments: [],
  contacts: [],
  technicians: [],
  items: [],
  attachments: {},
  files: {},
};

/** The stub, and what was written to it, for tests to read. */
export interface StubFsm extends FsmProvider {
  readonly made: { readonly contacts: NewFsmContact[]; readonly requests: NewFsmRequest[] };
}

/** Local and test stand-in: answers from the world it is given, and reaches nothing. What is written stays with it. */
export function createStubFsm(world: StubFsmWorld = EMPTY_FSM): StubFsm {
  const made = { contacts: [] as NewFsmContact[], requests: [] as NewFsmRequest[] };
  return {
    made,
    appointment: (id) => Promise.resolve(world.appointments.find((appointment) => appointment.id === id) ?? null),
    appointments: (page, perPage) => {
      const sorted = [...world.appointments].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      const start = (page - 1) * perPage;
      return Promise.resolve({
        appointments: sorted.slice(start, start + perPage),
        more: sorted.length > start + perPage,
      });
    },
    contact: (id) => Promise.resolve(world.contacts.find((contact) => contact.id === id) ?? null),
    technicians: () => Promise.resolve([...world.technicians]),
    items: () => Promise.resolve([...world.items]),
    attachments: (appointmentId) => Promise.resolve([...(world.attachments[appointmentId] ?? [])]),
    download: (fileId) => {
      const file = world.files[fileId];
      if (file === undefined) return Promise.reject(new Error("the stub FSM has no such file"));
      return Promise.resolve({
        body: new Response(file.bytes).body ?? new ReadableStream(),
        contentType: file.contentType,
      });
    },
    createContact: (contact) => {
      made.contacts.push(contact);
      return Promise.resolve(`stub-contact-${String(made.contacts.length)}`);
    },
    createRequest: (request) => {
      made.requests.push(request);
      return Promise.resolve(`stub-request-${String(made.requests.length)}`);
    },
  };
}

/** FSM_PROVIDER "none": every call fails plainly, since nothing should reach FSM where it is off. */
function createUnconnectedFsm(): FsmProvider {
  const off = () => Promise.reject(new Error("FSM is not connected here (FSM_PROVIDER is none)"));
  return {
    appointment: off,
    appointments: off,
    contact: off,
    technicians: off,
    items: off,
    attachments: off,
    download: off,
    createContact: off,
    createRequest: off,
  };
}
