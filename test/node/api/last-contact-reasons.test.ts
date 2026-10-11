// The CRM's Last_Contact_Reason (src/config/crm.ts; docs/decisions/0137-last-contact-in-the-crm.md) names every reason
// Care close a chat with, so no closed chat reaches the CRM without what it was about.

import { describe, expect, it } from "vitest";
import { LAST_CONTACT_REASONS } from "../../../src/config/crm.ts";
import { CLOSE_REASONS } from "../../../src/domain/care/replies.ts";

describe("the last contact's reasons", () => {
  it("name every reason a chat closes with, and nothing else", () => {
    expect(Object.keys(LAST_CONTACT_REASONS).sort()).toEqual([...CLOSE_REASONS].sort());
  });
});
