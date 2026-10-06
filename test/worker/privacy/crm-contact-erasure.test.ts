// An erased client's CRM Contact, which Books' own CRM integration made of their Books customer
// (src/domain/books/books-erasure.ts): read from the customer before it goes, then blanked and deleted. NOW is Monday
// 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eraseBooksCustomers } from "../../../src/domain/books/books-erasure.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubBooks, type StubBooks } from "../../../src/providers/books/stub.ts";
import type { CrmProvider } from "../../../src/providers/crm/index.ts";
import { createStubCrm } from "../../../src/providers/crm/stub.ts";
import { fakeDependencies, markDatabase, NOW, type TestDependencies } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "stub-customer-rohit";
/** The Contact the stub's CRM integration made of that customer. */
const CONTACT = `stub-crm-contact-${CUSTOMER}`;

let books: StubBooks;

beforeEach(async () => {
  await markDatabase();
  books = createStubBooks();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, books_customer_id, erased_at)
     VALUES (?1, ?2, '+919810000001', 'Erased', ?3, ?2)`,
  )
    .bind(PERSON, NOW.toISOString(), CUSTOMER)
    .run();
});

/** The stub CRM, remembering each Contact it erased; a test may make its next erasure fail. */
function recordingCrm() {
  const erased: string[] = [];
  let failing: string | null = null;
  const crm: CrmProvider = {
    ...createStubCrm(createLogger()),
    eraseContact(contactId) {
      if (failing !== null) {
        const reason = failing;
        failing = null;
        return Promise.reject(new Error(reason));
      }
      erased.push(contactId);
      return Promise.resolve({ found: true });
    },
  };
  return { crm, erased, failNext: (reason: string) => (failing = reason) };
}

const pass = (deps: TestDependencies) =>
  eraseBooksCustomers(env.DB, { ...deps, log: createLogger(), budget: createCallBudget(40) }, NOW);

const contactErasure = () =>
  env.DB.prepare("SELECT crm_contact_id, crm_contact_erased_at, crm_contact_erasure_attempts FROM people WHERE id = ?1")
    .bind(PERSON)
    .first();

describe("an erased client's CRM Contact", () => {
  it("is read from their Books customer, and erased once the customer is, once", async () => {
    const { crm, erased } = recordingCrm();
    const deps = fakeDependencies({ books, crm });

    expect(await pass(deps)).toBe(1);
    await pass(deps);

    expect(books.made.erased).toEqual([{ customerId: CUSTOMER, outcome: "deleted" }]);
    expect(erased).toEqual([CONTACT]);
    expect(await contactErasure()).toEqual({
      crm_contact_id: CONTACT,
      crm_contact_erased_at: NOW.toISOString(),
      crm_contact_erasure_attempts: 0,
    });
  });

  it("is kept to erase while Books has not erased the customer, which may yet write it back", async () => {
    const { crm, erased } = recordingCrm();
    const deps = fakeDependencies({ books, crm });

    books.failNext("eraseCustomer", "Books said 500");
    expect(await pass(deps)).toBe(0);
    expect(erased).toEqual([]);
    expect(await contactErasure()).toMatchObject({ crm_contact_id: CONTACT, crm_contact_erased_at: null });

    expect(await pass(deps)).toBe(1);
    expect(erased).toEqual([CONTACT]);
  });

  it("is tried again on the next run when the CRM fails, apart from the customer's tries", async () => {
    const { crm, erased, failNext } = recordingCrm();
    const deps = fakeDependencies({ books, crm });

    failNext("CRM said 500");
    expect(await pass(deps)).toBe(1);
    expect(await contactErasure()).toMatchObject({ crm_contact_erased_at: null, crm_contact_erasure_attempts: 1 });
    expect(deps.alerts).toEqual([]);

    await pass(deps);
    expect(erased).toEqual([CONTACT]);
    expect(await env.DB.prepare("SELECT books_erasure_attempts FROM people").first()).toEqual({
      books_erasure_attempts: 0,
    });
  });

  it("tells ops once the CRM has failed ten times, and is asked no more", async () => {
    const { crm, erased, failNext } = recordingCrm();
    const deps = fakeDependencies({ books, crm });
    failNext("CRM said 500");
    await pass(deps);
    await env.DB.prepare("UPDATE people SET crm_contact_erasure_attempts = 9 WHERE id = ?1").bind(PERSON).run();

    failNext("CRM said 500");
    await pass(deps);
    expect(deps.alerts).toEqual([expect.stringMatching(new RegExp(`Contact ${CONTACT}.*CRM said 500.*by hand`))]);

    await pass(deps);
    expect(erased).toEqual([]);
  });
});
