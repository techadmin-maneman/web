// Zoho FSM, the system of record for field work, behind an interface
// (docs/decisions/0032-fsm-mirror.md). Callers use FsmProvider; only this file
// knows which implementation runs, and only src/providers/fsm-zoho.ts knows
// FSM's API. Reads feed the D1 mirror. Writes put a booked lead into FSM, as a
// contact and a Request for ops to schedule, and a visit a client booked and
// paid for in the app, as a work order and its appointment.

import type { ZohoFsmSettings } from "../config/settings.ts";
import { FSM_BASE_PART_NAME, FSM_SERVICE_NAMES, VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import type { ZohoRequesterDependencies } from "./zoho-http.ts";
import { createZohoFsm } from "./fsm-zoho.ts";

/** The most calls one read of FSM's catalogue costs, a page of 200 items each. */
export { FSM_ITEM_PAGES } from "./fsm-zoho.ts";
import { ProviderError } from "./provider-error.ts";

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

/**
 * The Request a work order was converted from, and what the client asked for on
 * it. FSM keeps the preference on the Request alone: the appointment has the
 * same subform and it is read-only there, silently dropping anything written
 * to it (ADR 0063).
 */
export interface FsmRequestPreference {
  readonly requestId: string;
  /** YYYY-MM-DD, the day the client asked for; null where they named none. */
  readonly preferredDate: string | null;
  /** The window they asked for, in the words we wrote (`NewFsmRequest.preferenceNote`). */
  readonly preferenceNote: string | null;
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
  /** What it bills: the work order's total, in paise with GST, from FSM's catalogue prices. */
  readonly total: number;
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
  /** In paise before GST: what FSM prices a visit's invoice at (INT-03). Null where the item has none. */
  readonly price: number | null;
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

/** A person to add to FSM as a contact, with the street of their saved address where they have given one. */
export interface NewFsmContact {
  readonly firstName: string | null;
  readonly lastName: string;
  /** E.164, as the mirror matches it. */
  readonly mobile: string;
  readonly email: string | null;
  readonly city: string;
  /** The service address's pincode, where the booking or the client's saved address gave one. */
  readonly pincode: string | null;
  /** The street of the client's saved address; null leaves it to be confirmed with them. */
  readonly street: { readonly street1: string; readonly street2: string | null } | null;
  /** The state, e.g. Haryana, and its GST code, e.g. HR; null where the city is not one we know. */
  readonly state: string | null;
  readonly stateCode: string | null;
}

/** A client's details as they are now, to write over their contact after a change of number or address. */
export interface FsmContactUpdate {
  /** E.164, as the mirror matches it. */
  readonly mobile: string;
  /** The address the client gave; null leaves FSM's service address as it is. */
  readonly address: {
    readonly street1: string;
    readonly street2: string | null;
    readonly city: string;
    readonly pincode: string;
  } | null;
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
  /** Ours, the lead's ID, written on the Request so a retry can find one whose answer never reached us. */
  readonly reference: string;
}

/**
 * The org's own names for an appointment's blueprint transitions. FSM finds a
 * transition by its name, so a name it does not know is one it never offers.
 * Dispatch, Reschedule, Cancel and Terminate are the trial's
 * (docs/decisions/fsm-trial.md, question 7); Start Work and Complete Work are
 * what both staging runs of 23 September 2026 took (docs/verification.md, P2-M2).
 */
export type AppointmentTransition = "Dispatch" | "Start Work" | "Complete Work" | "Terminate" | "Cancel" | "Reschedule";

/** FSM's status after each transition. A reschedule leaves the appointment where it was. */
export const STATUS_AFTER: Readonly<Record<Exclude<AppointmentTransition, "Reschedule">, string>> = {
  Dispatch: "Dispatched",
  "Start Work": "In Progress",
  "Complete Work": "Completed",
  Terminate: "Terminated",
  Cancel: "Cancelled",
};

/**
 * A visit is booked in FSM in two writes: a work order for the service, then
 * its appointment with the technician. Each ID is kept as soon as FSM answers,
 * so a retry never makes either twice (docs/decisions/0068-a-paid-hold-is-kept.md).
 */
export interface NewFsmWorkOrder {
  readonly contactId: string;
  readonly summary: string;
  readonly serviceId: string;
  /** Ours, the hold's ID, written on the work order so a retry can find one whose answer never reached us. */
  readonly reference: string;
}

export interface NewFsmAppointment {
  readonly summary: string;
  /** The technician's service resource in FSM. */
  readonly technicianId: string;
  /** ISO 8601 with India's offset, as FSM takes it. */
  readonly start: string;
  readonly end: string;
}

/** A visit as the stub records it once it has both halves: what a test reads back. */
export interface NewFsmVisit {
  readonly contactId: string;
  readonly summary: string;
  readonly serviceId: string;
  readonly technicianId: string;
  readonly start: string;
  readonly end: string;
}

export interface FsmProvider {
  appointment(id: string): Promise<FsmAppointment | null>;
  /** One page of appointments, most recently changed first, for the reconciliation. */
  appointments(page: number, perPage: number): Promise<{ appointments: FsmAppointment[]; more: boolean }>;
  contact(id: string): Promise<FsmContact | null>;
  technicians(): Promise<FsmTechnician[]>;
  /** The whole catalogue, services and parts, read a page at a time up to FSM_ITEM_PAGES. */
  items(): Promise<FsmItem[]>;
  /**
   * Makes a service item for a service FSM does not have, at its price in paise before GST; returns its FSM ID
   * (docs/decisions/0085-services-ops-can-edit.md).
   */
  createItem(item: { readonly name: string; readonly price: number }): Promise<string>;
  /**
   * Writes a service's name and its price, in paise before GST, over its item
   * (docs/decisions/0073-prices-from-the-price-book.md, 0085-services-ops-can-edit.md).
   */
  updateItem(itemId: string, item: { readonly name: string; readonly price: number }): Promise<void>;
  /**
   * Adds a consumable to the catalogue as a part at Rs. 0: it is used on jobs
   * and never invoiced (docs/decisions/0087-consumables-and-stock.md). Returns its ID.
   */
  createPart(name: string): Promise<string>;
  /** Renames a catalogue item, as ops renamed the consumable it is. */
  renameItem(itemId: string, name: string): Promise<void>;
  /** The files attached to an appointment, such as its photographs. */
  attachments(appointmentId: string): Promise<FsmAttachment[]>;
  download(fileId: string): Promise<FsmDownload>;
  /** The contact FSM holds for this mobile number (E.164), if it holds one. */
  findContact(mobile: string): Promise<string | null>;
  /** Adds a contact, with a service address in their city; returns its FSM ID. */
  createContact(contact: NewFsmContact): Promise<string>;
  /** Writes a client's number, and their address as the service address, over their contact. */
  updateContact(contactId: string, update: FsmContactUpdate): Promise<void>;
  /** The Request carrying our reference, among the latest FSM holds; null if none does. */
  findRequest(reference: string): Promise<string | null>;
  /** Adds a Request against a contact's service address; returns its FSM ID. */
  createRequest(request: NewFsmRequest): Promise<string>;
  /** The work order carrying our reference, among the latest FSM holds; null if none does. */
  findWorkOrder(reference: string): Promise<string | null>;
  /** Adds a work order for one service against the contact's service address; returns its FSM ID. */
  createWorkOrder(order: NewFsmWorkOrder): Promise<string>;
  /** The appointment a work order's service line is already on; null while it has none. */
  workOrderAppointment(workOrderId: string): Promise<string | null>;
  /** Puts a work order's service line on an appointment with the technician; returns its FSM ID. */
  createAppointment(workOrderId: string, appointment: NewFsmAppointment): Promise<string>;
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
   * it from where the appointment is. Only its status says whether that is a
   * step FSM has already taken or one it refuses.
   */
  transitionAppointment(appointmentId: string, name: AppointmentTransition, note: string): Promise<boolean>;
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
  /**
   * What the client asked for on the Request this work order came from. Null
   * when the work order names no Request, which is every visit our own booking
   * makes: those are booked into the window the client picked.
   */
  requestPreference(workOrderId: string): Promise<FsmRequestPreference | null>;
  /** Anonymises an erased client's contact: name, numbers, e-mail and street; the city stays for the records. */
  eraseContact(contactId: string): Promise<void>;
}

export function createFsmProvider(
  provider: string | undefined,
  settings: ZohoFsmSettings | null,
  deps: ZohoRequesterDependencies,
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
  /** What the Request behind each work order asked for, by work order ID; a work order not here names no Request. */
  readonly preferences?: Record<string, FsmRequestPreference>;
  /**
   * What each work order bills, in paise, from FSM's catalogue. One not named
   * here has nothing on it to bill, as a free consultation has.
   */
  readonly totals?: Readonly<Record<string, number>>;
}

/**
 * What the stub offers an appointment in each status, as the org does. From
 * Scheduled, what the trial found (docs/decisions/fsm-trial.md, question 7);
 * Start Work from Dispatched and Complete Work from In Progress, as the staging
 * runs took them (docs/verification.md, P2-M2). Terminate from Dispatched and
 * In Progress is what a no-show and a partial job close with, and has not yet
 * been tried on the org (docs/decisions/0065-a-technicians-writes-reach-fsm.md).
 * A closed appointment offers nothing.
 */
export const STUB_TRANSITIONS: Readonly<Record<string, readonly AppointmentTransition[]>> = {
  Scheduled: ["Dispatch", "Reschedule", "Cancel", "Terminate"],
  Dispatched: ["Start Work", "Terminate"],
  "In Progress": ["Complete Work", "Terminate"],
};

/** The price book's own figures since 22 September 2026 (migration 0018), in paise before GST. */
const STUB_PRICES: Readonly<Record<VisitType, number>> = {
  consultation: 0,
  first_fit: 3_000_000,
  service: 200_000,
  replacement: 1_500_000,
};

/**
 * The catalogue scripts/setup-fsm.ts makes in FSM, which the local stub holds, so local bookings reach it. Its
 * prices are the local price book's, so the local catalogue check agrees with it.
 */
const CATALOGUE: FsmItem[] = [
  ...VISIT_TYPES.map((type, index) => ({
    id: `stub-service-${String(index + 1)}`,
    name: FSM_SERVICE_NAMES[type],
    type: "Service" as const,
    price: STUB_PRICES[type],
  })),
  { id: "stub-part-1", name: FSM_BASE_PART_NAME, type: "Part", price: null },
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
    readonly workOrders: NewFsmWorkOrder[];
    /** Each work order that has its appointment, as one visit. */
    readonly visits: NewFsmVisit[];
    readonly rescheduled: { appointmentId: string; start: string; end: string }[];
    readonly cancelled: { workOrderId: string; note: string }[];
    readonly invoiced: string[];
    readonly erased: string[];
    readonly contactUpdates: ({ contactId: string } & FsmContactUpdate)[];
    readonly assets: NewFsmAsset[];
    readonly assetUpdates: { assetId: string; status?: string }[];
    readonly assigned: { appointmentId: string; technicianId: string }[];
    readonly transitioned: { appointmentId: string; name: string; note: string }[];
    readonly appointmentUpdates: { appointmentId: string; fields: Record<string, string> }[];
    readonly attached: { appointmentId: string; name: string; contentType: string; bytes: number }[];
    /** Each service item made, and each written over, with its name and its price in paise before GST. */
    readonly itemsMade: { name: string; price: number }[];
    readonly itemUpdates: { itemId: string; name: string; price: number }[];
    /** Each part added to the catalogue, by name. */
    readonly parts: string[];
    /** Each catalogue item renamed. */
    readonly renamedItems: { itemId: string; name: string }[];
  };
  /** Makes the next call of this kind throw, so a test can prove the retry. */
  failNext(step: StubFsmStep, message?: string): void;
  /** Makes the next call of this kind refused, as FSM refuses: a 4xx with its own code. */
  refuseNext(step: StubFsmStep, code?: string): void;
  /**
   * Makes the next call of this kind take effect and then throw, as a call does
   * whose answer never reaches us: FSM has the record, and we do not know it.
   */
  loseAnswer(step: StubFsmCreate): void;
}

/** The creates whose answer a test can lose. */
export type StubFsmCreate =
  | "createContact"
  | "createRequest"
  | "createWorkOrder"
  | "createAppointment"
  | "createAsset"
  | "attachToAppointment"
  | "createItem"
  | "createPart";

/** The writes a test can make fail. */
export type StubFsmStep =
  | StubFsmCreate
  | "items"
  | "updateItem"
  | "renameItem"
  | "assets"
  | "createAsset"
  | "updateAsset"
  | "assignVisit"
  | "transitionAppointment"
  | "updateAppointment"
  | "attachToAppointment"
  | "rescheduleVisit"
  | "invoiceWorkOrder"
  | "requestPreference"
  | "updateContact";

/**
 * Local and test stand-in: answers from the world it is given, and reaches nothing. What is written stays with it,
 * under IDs no other stub gives, since a new stub answers each local request.
 */
export function createStubFsm(world: StubFsmWorld = EMPTY_FSM): StubFsm {
  const made = {
    contacts: [] as NewFsmContact[],
    requests: [] as NewFsmRequest[],
    workOrders: [] as NewFsmWorkOrder[],
    visits: [] as NewFsmVisit[],
    rescheduled: [] as { appointmentId: string; start: string; end: string }[],
    cancelled: [] as { workOrderId: string; note: string }[],
    invoiced: [] as string[],
    erased: [] as string[],
    contactUpdates: [] as ({ contactId: string } & FsmContactUpdate)[],
    assets: [] as NewFsmAsset[],
    assetUpdates: [] as { assetId: string; status?: string }[],
    assigned: [] as { appointmentId: string; technicianId: string }[],
    transitioned: [] as { appointmentId: string; name: string; note: string }[],
    appointmentUpdates: [] as { appointmentId: string; fields: Record<string, string> }[],
    attached: [] as { appointmentId: string; name: string; contentType: string; bytes: number }[],
    itemsMade: [] as { name: string; price: number }[],
    itemUpdates: [] as { itemId: string; name: string; price: number }[],
    parts: [] as string[],
    renamedItems: [] as { itemId: string; name: string }[],
  };
  const failures = new Map<StubFsmStep, Error>();
  /** Throws once if the test asked this step to fail; a retry then succeeds. */
  function checkFailure(step: StubFsmStep): void {
    const failure = failures.get(step);
    if (failure === undefined) return;
    failures.delete(step);
    throw failure;
  }

  const lostAnswers = new Set<StubFsmCreate>();
  /** A create that took effect answers with its ID, unless the test asked for its answer to be lost. */
  function answer(step: StubFsmCreate, id: string): Promise<string> {
    if (!lostAnswers.delete(step)) return Promise.resolve(id);
    return Promise.reject(new Error(`the stub FSM made ${id}, and its answer never came`));
  }

  // What the stub made, by the keys a retry looks it up by.
  const contactIds = new Map<string, string>();
  const requestIds = new Map<string, string>();
  const workOrderIds = new Map<string, string>();
  const workOrdersById = new Map<string, NewFsmWorkOrder>();
  const appointmentOfWorkOrder = new Map<string, string>();

  const stubAssets = world.assets ?? {};
  /** Pieces and files the stub was given since, by contact and by appointment, as FSM lists them back. */
  const madeAssets = new Map<string, FsmAsset[]>();
  const madeAttachments = new Map<string, FsmAttachment[]>();
  const invoices = new Map<string, FsmInvoice>();
  /** Catalogue items and parts made since, and names and prices written since over the ones the world gave. */
  const madeItems: FsmItem[] = [];
  const madeParts: FsmItem[] = [];
  const itemWrites = new Map<string, { name: string; price: number }>();
  const itemNames = new Map<string, string>();

  /** Where each appointment's transitions have moved it, over the status the world gave it. */
  const statuses = new Map<string, string>();
  function appointmentNow(id: string): FsmAppointment | null {
    const held = world.appointments.find((appointment) => appointment.id === id);
    if (held === undefined) return null;
    return { ...held, status: statuses.get(id) ?? held.status };
  }
  /** An appointment the stub does not hold offers nothing, as FSM offers nothing for a record it lacks. */
  function offeredFor(id: string): readonly AppointmentTransition[] {
    const status = appointmentNow(id)?.status;
    return status === undefined ? [] : (STUB_TRANSITIONS[status] ?? []);
  }

  return {
    made,
    failNext: (step, message = `the stub FSM refused ${step}`) => {
      failures.set(step, new Error(message));
    },
    refuseNext: (step, code = "INVALID_DATA") => {
      failures.set(step, new ProviderError(400, code, `the stub FSM refused ${step}`));
    },
    loseAnswer: (step) => {
      lostAnswers.add(step);
    },
    appointment: (id) => Promise.resolve(appointmentNow(id)),
    appointments: (page, perPage) => {
      const sorted = world.appointments
        .flatMap((appointment) => appointmentNow(appointment.id) ?? [])
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      const start = (page - 1) * perPage;
      return Promise.resolve({
        appointments: sorted.slice(start, start + perPage),
        more: sorted.length > start + perPage,
      });
    },
    contact: (id) => Promise.resolve(world.contacts.find((contact) => contact.id === id) ?? null),
    technicians: () => Promise.resolve([...world.technicians]),
    items: () => {
      checkFailure("items");
      return Promise.resolve(
        [...world.items, ...madeItems, ...madeParts].map((item) => {
          const written = { ...item, ...itemWrites.get(item.id) };
          return { ...written, name: itemNames.get(item.id) ?? written.name };
        }),
      );
    },
    createItem: (item) => {
      checkFailure("createItem");
      made.itemsMade.push({ ...item });
      const id = `stub-item-${crypto.randomUUID()}`;
      madeItems.push({ id, name: item.name, type: "Service", price: item.price });
      return answer("createItem", id);
    },
    updateItem: (itemId, item) => {
      checkFailure("updateItem");
      made.itemUpdates.push({ itemId, ...item });
      itemWrites.set(itemId, { ...item });
      return Promise.resolve();
    },
    createPart: (name) => {
      checkFailure("createPart");
      made.parts.push(name);
      const id = `stub-part-${crypto.randomUUID()}`;
      madeParts.push({ id, name, type: "Part", price: 0 });
      return answer("createPart", id);
    },
    renameItem: (itemId, name) => {
      checkFailure("renameItem");
      made.renamedItems.push({ itemId, name });
      itemNames.set(itemId, name);
      return Promise.resolve();
    },
    attachments: (appointmentId) =>
      Promise.resolve([...(world.attachments[appointmentId] ?? []), ...(madeAttachments.get(appointmentId) ?? [])]),
    download: (fileId) => {
      const file = world.files[fileId];
      if (file === undefined) return Promise.reject(new Error("the stub FSM has no such file"));
      return Promise.resolve({
        body: new Response(file.bytes).body ?? new ReadableStream(),
        contentType: file.contentType,
      });
    },
    findContact: (mobile) => {
      const held = world.contacts.find((contact) => contact.mobile === mobile);
      return Promise.resolve(held?.id ?? contactIds.get(mobile) ?? null);
    },
    createContact: (contact) => {
      checkFailure("createContact");
      made.contacts.push(contact);
      const id = `stub-contact-${crypto.randomUUID()}`;
      contactIds.set(contact.mobile, id);
      return answer("createContact", id);
    },
    findRequest: (reference) => Promise.resolve(requestIds.get(reference) ?? null),
    createRequest: (request) => {
      checkFailure("createRequest");
      made.requests.push(request);
      const id = `stub-request-${crypto.randomUUID()}`;
      requestIds.set(request.reference, id);
      return answer("createRequest", id);
    },
    findWorkOrder: (reference) => Promise.resolve(workOrderIds.get(reference) ?? null),
    createWorkOrder: (order) => {
      checkFailure("createWorkOrder");
      made.workOrders.push(order);
      const id = `stub-work-order-${crypto.randomUUID()}`;
      workOrderIds.set(order.reference, id);
      workOrdersById.set(id, order);
      return answer("createWorkOrder", id);
    },
    workOrderAppointment: (workOrderId) => Promise.resolve(appointmentOfWorkOrder.get(workOrderId) ?? null),
    createAppointment: (workOrderId, appointment) => {
      checkFailure("createAppointment");
      const order = workOrdersById.get(workOrderId);
      if (order === undefined) return Promise.reject(new Error("the stub FSM has no such work order"));
      // FSM's rule: a work order's service line is on one appointment only (docs/decisions/fsm-trial.md).
      if (appointmentOfWorkOrder.has(workOrderId)) {
        return Promise.reject(new Error("the stub FSM's service line is already on an appointment"));
      }
      made.visits.push({ contactId: order.contactId, serviceId: order.serviceId, ...appointment });
      const id = `stub-appointment-${crypto.randomUUID()}`;
      appointmentOfWorkOrder.set(workOrderId, id);
      return answer("createAppointment", id);
    },
    rescheduleVisit: (appointmentId, times) => {
      checkFailure("rescheduleVisit");
      made.rescheduled.push({ appointmentId, ...times });
      return Promise.resolve();
    },
    assets: (contactId) => {
      checkFailure("assets");
      return Promise.resolve([...(stubAssets[contactId] ?? []), ...(madeAssets.get(contactId) ?? [])]);
    },
    createAsset: (asset) => {
      checkFailure("createAsset");
      made.assets.push(asset);
      const id = `stub-asset-${crypto.randomUUID()}`;
      const held: FsmAsset = {
        id,
        assetNumber: asset.assetNumber,
        contactId: asset.contactId,
        productId: asset.productId,
        productName: null,
        serialNumber: asset.serialNumber,
        installedAt: asset.installedAt,
        status: "Active",
        modifiedAt: "",
      };
      madeAssets.set(asset.contactId, [...(madeAssets.get(asset.contactId) ?? []), held]);
      return answer("createAsset", id);
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
    appointmentTransitions: (appointmentId) => Promise.resolve([...offeredFor(appointmentId)]),
    transitionAppointment: (appointmentId, name, note) => {
      checkFailure("transitionAppointment");
      if (!offeredFor(appointmentId).includes(name)) return Promise.resolve(false);
      made.transitioned.push({ appointmentId, name, note });
      if (name !== "Reschedule") statuses.set(appointmentId, STATUS_AFTER[name]);
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
      const id = `stub-attachment-${crypto.randomUUID()}`;
      const held: FsmAttachment = { id, fileId: id, name: file.name, size: file.bytes.byteLength, createdAt: "" };
      madeAttachments.set(appointmentId, [...(madeAttachments.get(appointmentId) ?? []), held]);
      return answer("attachToAppointment", id);
    },
    cancelVisit: (workOrderId, note) => {
      made.cancelled.push({ workOrderId, note });
      return Promise.resolve(true);
    },
    invoiceWorkOrder: (workOrderId) => {
      checkFailure("invoiceWorkOrder");
      const total = world.totals?.[workOrderId] ?? 0;
      if (total <= 0) return Promise.resolve(null);
      // One invoice per work order, as FSM gives, however often it is asked for.
      const raised = invoices.get(workOrderId);
      if (raised !== undefined) return Promise.resolve({ ...raised, created: false });
      const id = crypto.randomUUID();
      const invoice = { id: `stub-fsm-invoice-${id}`, booksInvoiceId: `stub-invoice-${id}`, created: true, total };
      invoices.set(workOrderId, invoice);
      made.invoiced.push(workOrderId);
      return Promise.resolve(invoice);
    },
    requestPreference: (workOrderId) => {
      checkFailure("requestPreference");
      return Promise.resolve(world.preferences?.[workOrderId] ?? null);
    },
    updateContact: (contactId, update) => {
      checkFailure("updateContact");
      made.contactUpdates.push({ contactId, ...update });
      return Promise.resolve();
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
    createItem: off,
    updateItem: off,
    createPart: off,
    renameItem: off,
    attachments: off,
    download: off,
    findContact: off,
    createContact: off,
    updateContact: off,
    findRequest: off,
    createRequest: off,
    findWorkOrder: off,
    createWorkOrder: off,
    workOrderAppointment: off,
    createAppointment: off,
    rescheduleVisit: off,
    cancelVisit: off,
    invoiceWorkOrder: off,
    requestPreference: off,
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
