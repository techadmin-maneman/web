// The console's frame (packages/ui): a page's head and where it sits, its navigation, the row that narrows a list, a
// figure's tile, a setting on a line of its own, a state's badge and a button's panel. What a screen reader is told,
// and which control a label names, are held here.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Badge } from "../../packages/ui/Badge.tsx";
import { Breadcrumbs } from "../../packages/ui/Breadcrumbs.tsx";
import { EmptyState } from "../../packages/ui/EmptyState.tsx";
import { FigureGrid } from "../../packages/ui/FigureGrid.tsx";
import { NumberInput } from "../../packages/ui/Field.tsx";
import { Initials, initialsOf } from "../../packages/ui/Initials.tsx";
import { PageHeader } from "../../packages/ui/PageHeader.tsx";
import { Popover, PopoverItem } from "../../packages/ui/Popover.tsx";
import { SettingRow, SettingValue } from "../../packages/ui/SettingRow.tsx";
import { ChangeBar, SettingPairs, SubNav } from "../../packages/ui/SettingsLayout.tsx";
import { NavItem, SideNav } from "../../packages/ui/SideNav.tsx";
import { StatTile } from "../../packages/ui/StatTile.tsx";
import { Toolbar } from "../../packages/ui/Toolbar.tsx";

describe("a page's head", () => {
  const markup = renderToStaticMarkup(
    createElement(PageHeader, {
      title: "Technicians",
      meta: "12",
      actions: createElement("button", { type: "button" }, "Add"),
    }),
  );

  it("titles the page in its one first-level heading, which can take the keyboard", () => {
    expect(markup).toMatch(/<h1[^>]*tabindex="-1"[^>]*>Technicians<\/h1>/);
    expect([...markup.matchAll(/<h1/g)]).toHaveLength(1);
  });

  it("carries its figures and its actions", () => {
    expect(markup).toContain(">12</span>");
    expect(markup).toContain(">Add</button>");
  });

  it("sets the day and place above a title that is a sentence on them", () => {
    const sentence = renderToStaticMarkup(
      createElement(PageHeader, { title: "Every visit has a technician.", over: "Monday 2 November · Gurgaon" }),
    );
    expect(sentence.indexOf("Monday 2 November")).toBeLessThan(sentence.indexOf("<h1"));
  });

  it("draws a record's initials before its name, unread, and its badges and facts after", () => {
    const record = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Rohit Malhotra",
        mark: createElement(Initials, { name: "Rohit Malhotra" }),
        beside: createElement(Badge, { tone: "done", children: "Fitted" }),
        under: "Gurgaon",
      }),
    );
    expect(record).toMatch(/<span[^>]*aria-hidden="true"[^>]*>RM<\/span>/);
    expect(record.indexOf(">RM<")).toBeLessThan(record.indexOf("<h1"));
    expect(record.indexOf("</h1>")).toBeLessThan(record.indexOf("Fitted"));
    expect(record.indexOf("Fitted")).toBeLessThan(record.indexOf("Gurgaon"));
  });

  it("takes the first letters of a name's first two words", () => {
    expect(initialsOf("Rohit Malhotra")).toBe("RM");
    expect(initialsOf("  priya  ")).toBe("PR");
  });
});

describe("where a page sits", () => {
  const markup = renderToStaticMarkup(
    createElement(Breadcrumbs, {
      label: "Where you are",
      crumbs: [{ label: "Clients", to: "/clients" }, { label: "Rohit Malhotra" }],
    }),
  );

  it("is a named navigation, an ordered list of the pages above", () => {
    expect(markup).toMatch(/^<nav aria-label="Where you are"><ol/);
    expect(markup).toContain('href="/clients"');
  });

  it("marks the page itself, which is not a link", () => {
    expect(markup).toContain('<span aria-current="page">Rohit Malhotra</span>');
  });
});

describe("the navigation", () => {
  const nav = (folded: boolean) =>
    renderToStaticMarkup(
      createElement(SideNav, {
        label: "Console",
        folded,
        children: [
          createElement(NavItem, {
            key: "tasks",
            to: "/tasks",
            icon: "M0 0",
            name: "Tasks",
            current: true,
            count: 8,
            urgent: true,
            label: "Tasks, 8 waiting, some overdue",
          }),
          createElement(NavItem, {
            key: "dispatch",
            to: "/dispatch",
            icon: "M0 0",
            name: "Dispatch",
            current: false,
            count: 0,
          }),
        ],
      }),
    );

  it("is named, and marks the page open", () => {
    expect(nav(false)).toMatch(/^<nav[^>]*aria-label="Console"/);
    expect(nav(false)).toMatch(/<a[^>]*href="\/tasks"[^>]*aria-current="page"/);
  });

  it("reads an entry with how many wait in it, and shows no count where none wait", () => {
    expect(nav(false)).toContain('aria-label="Tasks, 8 waiting, some overdue"');
    expect(nav(false)).not.toMatch(/Dispatch<\/span><span/);
  });

  it("keeps each entry's name for the pointer and the screen reader once folded", () => {
    expect(nav(true)).toContain('data-folded="true"');
    expect(nav(true)).toContain('title="Dispatch"');
    expect(nav(true)).toContain(">Dispatch</span>");
  });
});

describe("Settings' own menu", () => {
  const markup = renderToStaticMarkup(
    createElement(SubNav, {
      label: "Settings",
      groups: [
        { name: "Visits", items: [{ name: "Field", to: "/settings/field", current: true }] },
        { name: "Team", items: [{ name: "Staff", to: "/settings/staff", current: false }] },
        { name: "Prices", items: [] },
      ],
    }),
  );

  it("leaves out a group with no page the person may open", () => {
    expect(markup).toContain("Visits</button>");
    expect(markup).not.toContain("Prices");
  });

  it("marks the page open", () => {
    expect(markup).toMatch(/href="\/settings\/field"[^>]*aria-current="page"/);
  });

  it("opens the open page's group and folds the rest, each group's name the button that says which", () => {
    expect(markup).toMatch(/aria-expanded="true"[^>]*>.*Visits<\/button><ul[^>]*>/);
    expect(markup).toMatch(/aria-expanded="false"[^>]*>.*Team<\/button><ul[^>]*hidden=""/);
  });
});

describe("a setting", () => {
  it("names its one box by its label, with the unit after it and what is wrong described", () => {
    const markup = renderToStaticMarkup(
      createElement(SettingRow, {
        label: "Check-in radius",
        unit: "metres",
        error: "Enter 50–500.",
        children: (control) => createElement(NumberInput, { ...control, defaultValue: 20 }),
      }),
    );
    const id = /<input[^>]* id="([^"]+)"/.exec(markup)?.[1];
    expect(markup).toContain(`<label class="`);
    expect(markup).toContain(`for="${String(id)}"`);
    expect(markup).toContain(">metres</span>");
    expect(markup).toMatch(/aria-invalid="true"/);
    expect([...markup.matchAll(/<input/g)]).toHaveLength(1);
  });

  it("is its value alone, with no box, for a person who may only look", () => {
    const markup = renderToStaticMarkup(createElement(SettingValue, { label: "Check-in radius", value: "200 metres" }));
    expect(markup).toContain(">200 metres</span>");
    expect(markup).not.toMatch(/<(input|select|textarea)/);
  });

  it("says how many changes wait, as they change", () => {
    const markup = renderToStaticMarkup(createElement(ChangeBar, { count: "2 changes", children: null }));
    expect(markup).toMatch(/<span[^>]*aria-live="polite"[^>]*>2 changes<\/span>/);
  });
});

describe("a figure's tile", () => {
  it("is a link where the figure is acted on", () => {
    const markup = renderToStaticMarkup(createElement(StatTile, { label: "Overdue", value: 4, to: "/tasks" }));
    expect(markup).toMatch(/^<a[^>]*href="\/tasks"/);
    expect(markup).toContain(">Overdue</span>");
    expect(markup).toContain(">4</span>");
  });

  it("is not a link without one", () => {
    expect(renderToStaticMarkup(createElement(StatTile, { label: "Visits", value: 18 }))).toMatch(/^<div/);
  });

  it("carries a short line beneath the figure where it has one", () => {
    const markup = renderToStaticMarkup(createElement(StatTile, { label: "Visits", value: 18, note: "6 done" }));
    expect(markup.indexOf(">18<")).toBeLessThan(markup.indexOf(">6 done<"));
    expect(renderToStaticMarkup(createElement(StatTile, { label: "Visits", value: 18 }))).not.toContain("6 done");
  });
});

describe("the row that narrows a list", () => {
  it("is a named search", () => {
    const markup = renderToStaticMarkup(createElement(Toolbar, { label: "Narrow the list", children: null }));
    expect(markup).toMatch(/^<div[^>]*role="search"[^>]*aria-label="Narrow the list"/);
  });
});

describe("a badge", () => {
  it("names the state in its words, in its tone", () => {
    const markup = renderToStaticMarkup(createElement(Badge, { tone: "warning", children: "Overdue" }));
    expect(markup).toMatch(/^<span class="[^"]+">Overdue<\/span>$/);
  });
});

describe("a button's panel", () => {
  let page: HTMLDivElement;
  let root: Root;
  let chosen = 0;

  beforeEach(() => {
    chosen = 0;
    page = document.createElement("div");
    document.body.append(page);
    root = createRoot(page);
    act(() => {
      root.render(
        createElement(Popover, {
          label: "Account",
          button: "AK",
          children: (close: () => void) =>
            createElement(PopoverItem, {
              onClick: () => {
                chosen += 1;
                close();
              },
              children: "Sign out",
            }),
        }),
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    page.remove();
  });

  const trigger = () => page.querySelector<HTMLButtonElement>('button[aria-label="Account"]');
  const item = () => [...page.querySelectorAll("button")].find((button) => button.textContent === "Sign out");

  it("is shut until its button is pressed, and says so", () => {
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(item()).toBeUndefined();
    act(() => {
      trigger()?.click();
    });
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(item()).toBeDefined();
  });

  it("shuts on Escape and gives the keyboard back to its button", () => {
    act(() => {
      trigger()?.click();
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(item()).toBeUndefined();
    expect(document.activeElement).toBe(trigger());
  });

  it("shuts on a press outside it", () => {
    act(() => {
      trigger()?.click();
    });
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(item()).toBeUndefined();
  });

  it("shuts once something in it is chosen", () => {
    act(() => {
      trigger()?.click();
    });
    act(() => {
      item()?.click();
    });
    expect(chosen).toBe(1);
    expect(item()).toBeUndefined();
  });
});

describe("a record's figures, and a tab with nothing yet", () => {
  it("names each figure before it, drawn beneath, in the tone it is given", () => {
    const markup = renderToStaticMarkup(
      createElement(FigureGrid, {
        figures: [
          { label: "Paid to date", value: "Rs. 31,000" },
          { label: "Replace by", value: "4 Nov", tone: "warning" },
        ],
      }),
    );
    expect(markup.indexOf("Paid to date")).toBeLessThan(markup.indexOf("Rs. 31,000"));
    expect(markup).toMatch(/<dd class="[^"]*warning[^"]*">4 Nov<\/dd>/);
  });

  it("says what is missing and why, with the next action", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptyState, {
        look: "next",
        line: "Nothing booked",
        detail: "Their service visit fell due on 12 Nov.",
        action: createElement("button", { type: "button" }, "Book a visit"),
      }),
    );
    expect(markup).toContain(">Nothing booked</p>");
    expect(markup.indexOf("fell due")).toBeLessThan(markup.indexOf(">Book a visit</button>"));
  });
});

describe("a rule's figures, two to a row", () => {
  it("names the pair's group where it is given a name, and holds its rows in order", () => {
    const markup = renderToStaticMarkup(
      createElement(SettingPairs, {
        label: "No-show charge",
        children: [createElement("div", { key: "a" }, "Consultation"), createElement("div", { key: "b" }, "First fit")],
      }),
    );
    expect(markup).toMatch(/^<div class="[^"]+" role="group" aria-label="No-show charge">/);
    expect(markup.indexOf("Consultation")).toBeLessThan(markup.indexOf("First fit"));
    expect(renderToStaticMarkup(createElement(SettingPairs, { children: "x" }))).not.toContain("role=");
  });
});
