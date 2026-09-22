// Zoho FSM, the system of record for field work, behind an interface
// (docs/decisions/0032-fsm-mirror.md). Callers use FsmProvider; only this file
// knows which implementation runs, and only src/providers/fsm-zoho.ts knows
// FSM's API. Reads feed the D1 mirror; nothing here writes yet.

import type { ZohoFsmSettings } from "../config/settings.ts";
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
}

export function createFsmProvider(
  provider: string | undefined,
  settings: ZohoFsmSettings | null,
  deps: { db: D1Database; fetch: typeof fetch; now: () => Date; log: Logger },
): FsmProvider {
  if (provider === "zoho" && settings !== null) return createZohoFsm(settings, deps);
  if (provider === "stub") return createStubFsm();
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

export const EMPTY_FSM: StubFsmWorld = {
  appointments: [],
  contacts: [],
  technicians: [],
  items: [],
  attachments: {},
  files: {},
};

/** Local and test stand-in: answers from the world it is given, and reaches nothing. */
export function createStubFsm(world: StubFsmWorld = EMPTY_FSM): FsmProvider {
  return {
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
  };
}
