// The client app's Support card (apps/app/src/profile/SupportCard.tsx; docs/decisions/0136-care-names.md): WhatsApp,
// and the client's Care person by the name Customer Care gave them.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { profile } from "../../apps/app/src/content.ts";
import { SupportCard } from "../../apps/app/src/profile/SupportCard.tsx";

let page: HTMLElement;
let root: Root;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
});

const draw = (carePerson: string | null) => {
  act(() => {
    root.render(createElement(SupportCard, { carePerson, hours: { opens: 9, closes: 21, first_reply: 60 } }));
  });
};

describe("the Support card", () => {
  it("names the client’s Care person", () => {
    draw("Asha");
    expect(page.textContent).toContain("Asha, your Care person");
    expect(page.textContent).toContain(profile.support.message);
  });

  it("says nothing of one before they have a name", () => {
    draw(null);
    expect(page.textContent).not.toContain("your Care person");
  });

  // It promised a reply the same day, where a message after hours waits for the morning, and gave the hours only to a
  // client with a Care person.
  it("promises the reply time and the hours Care set, to every client", () => {
    draw(null);
    expect(page.textContent).toContain("We reply within an hour, 9\u00a0am–9\u00a0pm daily.");
  });
});
