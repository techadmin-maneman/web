// Zoho FSM, the system of record for field work, behind an interface
// (docs/decisions/0032-fsm-mirror.md). Callers use FsmProvider; only this file
// knows which implementation runs, and only src/providers/fsm-zoho.ts knows
// FSM's API. Reads feed the D1 mirror. Writes put a booked lead into FSM, as a
// contact and a Request for ops to schedule, and a visit a client booked and
// paid for in the app, as a work order and its appointment.

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
  readonly modifiedAt: string;
}

/** A work order's invoice. FSM's Invoices module is a link: the document itself lives in Books. */
export interface FsmInvoice {
  /** FSM's own record, e.g. the one its Invoices screen shows. */
  readonly id: string;
  /** The same invoice in Books, which is where its number and its PDF come from. */
  readonly booksInvoiceId: string;
  /**
   * True when this call raised it, false when the work order already had one —
   * raised by hand in FSM, or by an earlier pass. Only an invoice this call
   * raised is ever marked sent (ADR 0056).
   */
  readonly created: boolean;
}

export interface FsmContact {
  readonly id: string;
  readonly name: string;
  /** As FSM holds it; the mirror turns it into E.164. */
  readonly mobile: string | null;
  readonly email: string | null;
  /** The same client in Books, once FSM's sync has put them there. */
  readonly booksCustomerId?: string | null;
}

/** A service resource: the technician FSM assigns appointments to. */
export interface FsmTechnician {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly active: boolean;
  /** As FSM holds it on the user; the mirror turns it into E.164. Null where the user has none. */
  readonly mobile: string | null;
  /** FSM's territory: the zone the dispatch board groups him by. */
  readonly zone: string | null;
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

/** A piece, as FSM holds it: an asset against a contact, labelled with our code. */
export interface FsmAsset {
  readonly id: string;
  /** Our label on the piece, e.g. "MM-STD-4417-B". */
  readonly assetNumber: string;
  readonly contactId: string | null;
  /** The part item the piece is built on: its base. */
  readonly productId: string | null;
  readonly productName: string | null;
  /** The supplier's lot, which FSM holds as the serial number. */
  readonly serialNumber: string | null;
  readonly installedAt: string | null;
  readonly status: string | null;
  readonly modifiedAt: string;
}

/** A piece to record in FSM once it is fitted. */
export interface NewFsmAsset {
  readonly contactId: string;
  readonly assetNumber: string;
  /** The part item in FSM's catalogue; an asset needs one. */
  readonly productId: string;
  readonly serialNumber: string | null;
  /** YYYY-MM-DD, the day it was fitted. */
  readonly installedAt: string;
}

/** A photograph or other file to put on an FSM record. */
export interface FsmUpload {
  /** Carries the phase and angle, e.g. "before-front.jpg", so the mirror reads it back. */
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
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

/** A visit to book in FSM: a work order for the service, and its appointment with the technician. */
export interface NewFsmVisit {
  readonly contactId: string;
  readonly summary: string;
  readonly serviceId: string;
  /** The technician's service resource in FSM. */
  readonly technicianId: string;
  /** ISO 8601 with India's offset, as FSM takes it. */
  readonly start: string;
  readonly end: string;
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
  /** Books a visit: a work order and its appointment, assigned to the technician. */
  createVisit(visit: NewFsmVisit): Promise<{ workOrderId: string; appointmentId: string }>;
  /** Moves an appointment to new times, with the same technician. ISO 8601 with India's offset. */
  rescheduleVisit(appointmentId: string, times: { start: string; end: string }): Promise<void>;
  /** The pieces FSM holds against a contact, newest first. */
  assets(contactId: string): Promise<FsmAsset[]>;
  /** Records a fitted piece as an asset; returns its FSM ID. */
  createAsset(asset: NewFsmAsset): Promise<string>;
  /** Changes an asset's status, e.g. when a piece failed. */
  updateAsset(assetId: string, fields: { status?: string }): Promise<void>;
  /** Puts an appointment on another technician. */
  assignVisit(appointmentId: string, technicianId: string): Promise<void>;
  /** The blueprint transitions FSM offers an appointment right now, by name. */
  appointmentTransitions(appointmentId: string): Promise<string[]>;
  /**
   * Makes one of them, with its mandatory note; false when FSM does not offer
   * it, which is how a job FSM has already moved past says so.
   */
  transitionAppointment(appointmentId: string, name: string, note: string): Promise<boolean>;
  /** Writes the job's own fields on the appointment, e.g. its summary. */
  updateAppointment(appointmentId: string, fields: Record<string, string>): Promise<void>;
  /** Uploads a file and attaches it to an appointment; returns FSM's attachment ID. */
  attachToAppointment(appointmentId: string, file: FsmUpload): Promise<string>;
  /** Cancels a work order, and so its appointment, with a note for ops; false if FSM no longer allows it. */
  cancelVisit(workOrderId: string, note: string): Promise<boolean>;
  /**
   * Bills a finished job: raises the work order's invoice if it has none, and
   * answers the invoice either way, so a job the owner invoiced by hand in FSM
   * comes back the same. Null when there is nothing to bill.
   */
  invoiceWorkOrder(workOrderId: string): Promise<FsmInvoice | null>;
  /** Anonymises an erased client's contact: name, numbers, e-mail and street; the city stays for the records. */
  eraseContact(contactId: string): Promise<void>;
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
  /** Pieces by contact ID. */
  readonly assets?: Record<string, FsmAsset[]>;
  /** The transitions each appointment offers, by appointment ID; the default is below. */
  readonly transitions?: Record<string, string[]>;
  /** Work orders with nothing to bill, as a free consultation has. */
  readonly unbillable?: string[];
}

/** What FSM offers a scheduled appointment, as the trial found (docs/decisions/fsm-trial.md). */
export const STUB_TRANSITIONS = ["Dispatch", "Reschedule", "Cancel", "Terminate", "Start", "Complete"];

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
  readonly made: {
    readonly contacts: NewFsmContact[];
    readonly requests: NewFsmRequest[];
    readonly visits: NewFsmVisit[];
    readonly rescheduled: { appointmentId: string; start: string; end: string }[];
    readonly cancelled: { workOrderId: string; note: string }[];
    readonly invoiced: string[];
    readonly erased: string[];
    readonly assets: NewFsmAsset[];
    readonly assetUpdates: { assetId: string; status?: string }[];
    readonly assigned: { appointmentId: string; technicianId: string }[];
    readonly transitioned: { appointmentId: string; name: string; note: string }[];
    readonly appointmentUpdates: { appointmentId: string; fields: Record<string, string> }[];
    readonly attached: { appointmentId: string; name: string; contentType: string; bytes: number }[];
  };
  /** Makes the next call of this kind throw, so a test can prove the retry. */
  failNext(step: StubFsmStep, message?: string): void;
}

/** The writes a test can make fail. */
export type StubFsmStep =
  | "assets"
  | "createAsset"
  | "updateAsset"
  | "assignVisit"
  | "transitionAppointment"
  | "updateAppointment"
  | "attachToAppointment"
  | "rescheduleVisit"
  | "invoiceWorkOrder";

/**
 * Local and test stand-in: answers from the world it is given, and reaches nothing. What is written stays with it,
 * under IDs no other stub gives, since a new stub answers each local request.
 */
export function createStubFsm(world: StubFsmWorld = EMPTY_FSM): StubFsm {
  const made = {
    contacts: [] as NewFsmContact[],
    requests: [] as NewFsmRequest[],
    visits: [] as NewFsmVisit[],
    rescheduled: [] as { appointmentId: string; start: string; end: string }[],
    cancelled: [] as { workOrderId: string; note: string }[],
    invoiced: [] as string[],
    erased: [] as string[],
    assets: [] as NewFsmAsset[],
    assetUpdates: [] as { assetId: string; status?: string }[],
    assigned: [] as { appointmentId: string; technicianId: string }[],
    transitioned: [] as { appointmentId: string; name: string; note: string }[],
    appointmentUpdates: [] as { appointmentId: string; fields: Record<string, string> }[],
    attached: [] as { appointmentId: string; name: string; contentType: string; bytes: number }[],
  };
  const failures = new Map<StubFsmStep, string>();
  /** Throws once if the test asked this step to fail; a retry then succeeds. */
  function checkFailure(step: StubFsmStep): void {
    const message = failures.get(step);
    if (message === undefined) return;
    failures.delete(step);
    throw new Error(message);
  }

  const stubAssets = world.assets ?? {};
  const invoices = new Map<string, FsmInvoice>();
  return {
    made,
    failNext: (step, message = `the stub FSM refused ${step}`) => {
      failures.set(step, message);
    },
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
      return Promise.resolve(`stub-contact-${crypto.randomUUID()}`);
    },
    createRequest: (request) => {
      made.requests.push(request);
      return Promise.resolve(`stub-request-${crypto.randomUUID()}`);
    },
    createVisit: (visit) => {
      made.visits.push(visit);
      const id = crypto.randomUUID();
      return Promise.resolve({ workOrderId: `stub-work-order-${id}`, appointmentId: `stub-appointment-${id}` });
    },
    rescheduleVisit: (appointmentId, times) => {
      checkFailure("rescheduleVisit");
      made.rescheduled.push({ appointmentId, ...times });
      return Promise.resolve();
    },
    assets: (contactId) => {
      checkFailure("assets");
      return Promise.resolve([...(stubAssets[contactId] ?? [])]);
    },
    createAsset: (asset) => {
      checkFailure("createAsset");
      made.assets.push(asset);
      return Promise.resolve(`stub-asset-${crypto.randomUUID()}`);
    },
    updateAsset: (assetId, fields) => {
      checkFailure("updateAsset");
      made.assetUpdates.push({ assetId, ...fields });
      return Promise.resolve();
    },
    assignVisit: (appointmentId, technicianId) => {
      checkFailure("assignVisit");
      made.assigned.push({ appointmentId, technicianId });
      return Promise.resolve();
    },
    appointmentTransitions: (appointmentId) =>
      Promise.resolve([...(world.transitions?.[appointmentId] ?? STUB_TRANSITIONS)]),
    transitionAppointment: (appointmentId, name, note) => {
      checkFailure("transitionAppointment");
      const offered = world.transitions?.[appointmentId] ?? STUB_TRANSITIONS;
      if (!offered.includes(name)) return Promise.resolve(false);
      made.transitioned.push({ appointmentId, name, note });
      return Promise.resolve(true);
    },
    updateAppointment: (appointmentId, fields) => {
      checkFailure("updateAppointment");
      made.appointmentUpdates.push({ appointmentId, fields });
      return Promise.resolve();
    },
    attachToAppointment: (appointmentId, file) => {
      checkFailure("attachToAppointment");
      made.attached.push({
        appointmentId,
        name: file.name,
        contentType: file.contentType,
        bytes: file.bytes.byteLength,
      });
      return Promise.resolve(`stub-attachment-${crypto.randomUUID()}`);
    },
    cancelVisit: (workOrderId, note) => {
      made.cancelled.push({ workOrderId, note });
      return Promise.resolve(true);
    },
    invoiceWorkOrder: (workOrderId) => {
      checkFailure("invoiceWorkOrder");
      if (world.unbillable?.includes(workOrderId) === true) return Promise.resolve(null);
      // One invoice per work order, as FSM gives, however often it is asked for.
      const raised = invoices.get(workOrderId);
      if (raised !== undefined) return Promise.resolve({ ...raised, created: false });
      const id = crypto.randomUUID();
      const invoice = { id: `stub-fsm-invoice-${id}`, booksInvoiceId: `stub-invoice-${id}`, created: true };
      invoices.set(workOrderId, invoice);
      made.invoiced.push(workOrderId);
      return Promise.resolve(invoice);
    },
    eraseContact: (contactId) => {
      made.erased.push(contactId);
      return Promise.resolve();
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
    createVisit: off,
    rescheduleVisit: off,
    cancelVisit: off,
    invoiceWorkOrder: off,
    eraseContact: off,
    assets: off,
    createAsset: off,
    updateAsset: off,
    assignVisit: off,
    appointmentTransitions: off,
    transitionAppointment: off,
    updateAppointment: off,
    attachToAppointment: off,
  };
}
