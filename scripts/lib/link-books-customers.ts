// Which staging clients take the Books customer FSM's own Books integration made for them, when staging leaves FSM
// (scripts/link-books-customers.ts). Kept on the client, it is the customer the Books pass writes to, rather than a
// second one it would make under the client's ID.

/** A client FSM holds a contact for, with no Books customer kept on them yet, as D1 lists them. */
export interface UnlinkedPerson {
  readonly id: string;
  readonly fsm_contact_id: string;
}

/** What FSM said of one contact. */
export type FsmContactRead =
  | { readonly state: "customer"; readonly customerId: string }
  | { readonly state: "no_customer" }
  | { readonly state: "gone" }
  | { readonly state: "unreadable"; readonly status: number };

export interface Link {
  readonly personId: string;
  readonly customerId: string;
}

export interface LinkPlan {
  readonly links: readonly Link[];
  readonly skipped: readonly { readonly personId: string; readonly reason: string }[];
}

/** FSM's answer to GET /fsm/v1/Contacts/{id}: the contact under `data`, or 204 for one it no longer holds. */
export function readContactAnswer(status: number, body: unknown): FsmContactRead {
  if (status === 204 || status === 404) return { state: "gone" };
  if (status !== 200) return { state: "unreadable", status };

  const records = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(records)) return { state: "unreadable", status };
  const [contact] = records as { ZBilling_Id?: unknown }[];
  if (contact === undefined) return { state: "gone" };

  const customerId = contact.ZBilling_Id;
  if (typeof customerId !== "string" || customerId === "") return { state: "no_customer" };
  return { state: "customer", customerId };
}

/**
 * Each client's link, from what FSM said of their contact. A customer another client holds, in D1 or earlier in this
 * plan, is never given to a second.
 */
export function planLinks(
  people: readonly UnlinkedPerson[],
  reads: ReadonlyMap<string, FsmContactRead>,
  taken: ReadonlySet<string>,
): LinkPlan {
  const held = new Set(taken);
  const links: Link[] = [];
  const skipped: { personId: string; reason: string }[] = [];
  for (const person of people) {
    const read = reads.get(person.fsm_contact_id);
    const customerId = read?.state === "customer" && !held.has(read.customerId) ? read.customerId : null;
    if (customerId === null) {
      skipped.push({ personId: person.id, reason: skipReason(read) });
      continue;
    }
    held.add(customerId);
    links.push({ personId: person.id, customerId });
  }
  return { links, skipped };
}

/** Why a client is not linked, in words for whoever runs the script. */
function skipReason(read: FsmContactRead | undefined): string {
  if (read === undefined) return "FSM was not asked";
  switch (read.state) {
    case "no_customer":
      return "FSM made no Books customer for them";
    case "gone":
      return "FSM no longer holds their contact";
    case "unreadable":
      return `FSM answered ${String(read.status)}`;
    case "customer":
      return "another client holds that customer";
  }
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Keeps the customer on the client, and marks their details changed, so the Books pass writes them over it with the
 * client's ID in "MM person ID". Changes nothing once the client has a customer, or another client has this one.
 */
export function linkStatement(link: Link, now: Date): string {
  const customer = quote(link.customerId);
  return (
    `UPDATE people SET books_customer_id = ${customer}, books_details_changed_at = ${quote(now.toISOString())} ` +
    `WHERE id = ${quote(link.personId)} AND books_customer_id IS NULL ` +
    `AND NOT EXISTS (SELECT 1 FROM people other WHERE other.books_customer_id = ${customer});`
  );
}
