// The console's parts for a phone and its pickers (packages/ui): the navigation's groups, the tab bar at a phone's
// foot, a list's row in place of a table's, with a time before it and an action beside it, the rule a pressing row
// carries, a row that opens a drawer, a filter's count and its chosen fill, a picker's choices, a drawer's actions pinned at its foot, and
// the search with its results beneath. What a screen reader is told is held here.

import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Drawer } from "../../packages/ui/Drawer.tsx";
import { Initials } from "../../packages/ui/Initials.tsx";
import { ListRow, ListRows } from "../../packages/ui/ListRow.tsx";
import { Popover, PopoverChoice, PopoverHeading } from "../../packages/ui/Popover.tsx";
import { SearchMenu } from "../../packages/ui/SearchMenu.tsx";
import { NavGroup, NavItem, SideNav } from "../../packages/ui/SideNav.tsx";
import { TabBar, TabBarItem } from "../../packages/ui/TabBar.tsx";
import { RowOpener, rowRule } from "../../packages/ui/Table.tsx";
import { ToggleButton } from "../../packages/ui/ToggleButton.tsx";

const css = (name: string) => readFileSync(`packages/ui/${name}`, "utf8");
const classOf = (markup: string) => /class="([^"]*)"/.exec(markup)?.[1] ?? "";

describe("the navigation's groups", () => {
  const markup = renderToStaticMarkup(
    createElement(SideNav, {
      label: "Console",
      children: createElement(NavGroup, {
        label: "Group",
        children: createElement(NavItem, { to: "/tasks", icon: "M0 0", name: "Tasks", current: true }),
      }),
    }),
  );

  it("name their entries by the group's name", () => {
    const id = /<span[^>]* id="([^"]+)">Group<\/span>/.exec(markup)?.[1];
    expect(id).toBeDefined();
    expect(markup).toMatch(new RegExp(`<ul class="[^"]*" aria-labelledby="${id ?? ""}"><li>`));
  });

  it("fold the group's name away with the entries' names", () => {
    expect(css("side-nav.module.css")).toMatch(/\[data-folded="true"\] \.groupLabel/);
  });
});

describe("the tab bar", () => {
  const bar = renderToStaticMarkup(
    createElement(TabBar, {
      label: "Console",
      children: [
        createElement(TabBarItem, {
          key: "tasks",
          to: "/tasks",
          icon: "M0 0",
          name: "Tasks",
          current: true,
          count: 8,
          urgent: true,
          label: "Tasks, 8 waiting, some overdue",
        }),
        createElement(TabBarItem, {
          key: "today",
          to: "/today",
          icon: "M0 0",
          name: "Today",
          current: false,
          count: 0,
        }),
        createElement(TabBarItem, { key: "more", to: "/more", icon: "M0 0", name: "More", current: false, count: 3 }),
      ],
    }),
  );

  it("is a named navigation, the open tab marked", () => {
    expect(bar).toMatch(/^<nav[^>]* aria-label="Console"/);
    expect(bar).toMatch(/href="\/tasks" aria-current="page" aria-label="Tasks, 8 waiting, some overdue"/);
    expect(bar).not.toMatch(/href="\/today" aria-current/);
  });

  it("shows how many wait, and nothing where none do, in another look where some are overdue", () => {
    const counts = [...bar.matchAll(/<span class="([^"]*)">(\d+)<\/span>/g)].map((match) => [match[1], match[2]]);
    expect(counts.map(([, count]) => count)).toEqual(["8", "3"]);
    expect(counts[0]?.[0]).not.toBe(counts[1]?.[0]);
  });

  it("gives every tab a finger's height and keeps clear of the home indicator", () => {
    expect(css("tab-bar.module.css")).toMatch(/\.tab \{[^}]*min-height: var\(--tap\)/);
    expect(css("tab-bar.module.css")).toMatch(/padding-bottom: env\(safe-area-inset-bottom\)/);
  });
});

describe("a list's row", () => {
  const row = (props: Partial<Parameters<typeof ListRow>[0]>) =>
    renderToStaticMarkup(createElement(ListRow, { title: "Address to confirm", meta: "Kunal Shah", ...props }));

  it("opens a page as a link, or something in place as a button, or is words alone", () => {
    expect(row({ to: "/tasks" })).toMatch(/^<li><a [^>]*href="\/tasks"/);
    expect(row({ onClick: () => undefined })).toMatch(/^<li><button type="button"/);
    expect(row({})).toMatch(/^<li><div /);
  });

  it("reads as what it is, who it is about, and its one figure", () => {
    const markup = row({ end: "Today", onClick: () => undefined });
    expect(
      markup
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ).toBe("Address to confirm Kunal Shah Today");
  });

  it("carries a rule in its tone, and none where nothing presses", () => {
    const none = classOf(row({}).replace(/^<li>/, ""));
    const late = classOf(row({ rule: "warning" }).replace(/^<li>/, ""));
    const today = classOf(row({ rule: "attention" }).replace(/^<li>/, ""));
    expect(late.split(" ")).toHaveLength(none.split(" ").length + 1);
    expect(late).not.toBe(today);
  });

  it("leads with a time in a column of its own, before what it is", () => {
    const markup = row({ lead: "11:30 am", end: "Late" });
    expect(markup.indexOf("11:30 am")).toBeLessThan(markup.indexOf("Address to confirm"));
    expect(markup).toMatch(/<span class="[^"]+">11:30 am<\/span>/);
  });

  it("draws a person's initials before the words, unread, and says which row is open beside the list", () => {
    const markup = row({
      mark: createElement(Initials, { name: "Kunal Shah", small: true }),
      onClick: () => undefined,
      current: true,
    });
    expect(markup).toMatch(/<button type="button" class="[^"]+" aria-current="true">/);
    expect(markup.indexOf(">KS<")).toBeLessThan(markup.indexOf("Address to confirm"));
    expect(row({ onClick: () => undefined })).not.toContain("aria-current");
  });

  it("sets its one action beside the row, outside what pressing the row opens", () => {
    const markup = row({ to: "/clients/1", action: createElement("button", { type: "button" }, "Assign") });
    expect(markup).toMatch(/^<li class="[^"]+"><a [^>]*href="\/clients\/1"[^>]*>.*<\/a><span class="[^"]+"><button/);
    expect(row({ to: "/clients/1" })).toMatch(/^<li><a /);
  });

  it("lists its rows under one name", () => {
    expect(
      renderToStaticMarkup(
        createElement(ListRows, {
          label: "Tasks",
          children: createElement(ListRow, { title: "Address to confirm" }),
        }),
      ),
    ).toMatch(/^<ul class="[^"]*" aria-label="Tasks"><li>/);
  });
});

describe("a table row's rule", () => {
  it("is a class of its own for each tone, and none without one", () => {
    expect(rowRule(undefined)).toBeUndefined();
    const rules = new Set([rowRule("attention"), rowRule("warning"), rowRule("error")]);
    expect(rules.size).toBe(3);
    expect(css("table.module.css")).toMatch(/box-shadow: inset var\(--rule-strong\) 0 0 0 var\(--rule\)/);
  });
});

describe("a picker", () => {
  let page: HTMLDivElement;
  let root: Root;
  let picked = "";

  beforeEach(() => {
    picked = "";
    page = document.createElement("div");
    document.body.append(page);
    root = createRoot(page);
    act(() => {
      root.render(
        createElement(Popover, {
          look: "field",
          label: "City: Gurgaon",
          button: "Gurgaon",
          children: (close: () => void) => [
            createElement(PopoverHeading, { key: "heading", children: "Stores" }),
            ...["Gurgaon", "Mumbai"].map((city) =>
              createElement(PopoverChoice, {
                key: city,
                chosen: city === "Gurgaon",
                detail: city === "Mumbai" ? "1 low" : undefined,
                detailTone: "warning",
                onClick: () => {
                  picked = city;
                  close();
                },
                children: city,
              }),
            ),
          ],
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

  const trigger = () => page.querySelector<HTMLButtonElement>('button[aria-label="City: Gurgaon"]');
  const choice = (city: string) =>
    [...page.querySelectorAll<HTMLButtonElement>("button:not([aria-label])")].find((button) =>
      button.textContent.startsWith(city),
    );

  it("shows what is chosen in its box, and its name holds those words", () => {
    expect(trigger()?.textContent).toBe("Gurgaon");
    expect(trigger()?.getAttribute("aria-label")).toContain(trigger()?.textContent);
  });

  it("marks the chosen one alone, under its heading, with a figure beside another", () => {
    act(() => {
      trigger()?.click();
    });
    expect(page.textContent).toContain("Stores");
    expect(choice("Gurgaon")?.getAttribute("aria-current")).toBe("true");
    expect(choice("Mumbai")?.hasAttribute("aria-current")).toBe(false);
    expect(choice("Mumbai")?.textContent).toBe("Mumbai1 low");
  });

  it("takes a choice and shuts", () => {
    act(() => {
      trigger()?.click();
    });
    act(() => {
      choice("Mumbai")?.click();
    });
    expect(picked).toBe("Mumbai");
    expect(choice("Mumbai")).toBeUndefined();
  });
});

describe("a drawer's foot", () => {
  const drawer = (onSubmit?: () => void) =>
    renderToStaticMarkup(
      createElement(Drawer, {
        titleId: "t",
        title: "Task",
        close: "Close",
        onDismiss: () => undefined,
        onSubmit,
        foot: createElement("button", { type: "submit" }, "Take it"),
        children: createElement("p", null, "Facts"),
      }),
    );

  it("holds the actions after the body, inside the drawer's form where it is one", () => {
    expect(drawer(() => undefined)).toMatch(/<form[^>]*><div[^>]*><p>Facts<\/p><\/div><div[^>]*><button[^>]*>Take it/);
    expect(drawer()).not.toContain("<form");
    expect(drawer()).toMatch(/<p>Facts<\/p><\/div><div[^>]*><button[^>]*>Take it/);
  });

  it("stays at the window's foot and fills the window on a phone", () => {
    expect(css("drawer.module.css")).toMatch(/\.foot \{[^}]*position: sticky;[^}]*bottom: 0/);
    expect(css("drawer.module.css")).toMatch(/max-width: 600px\)[\s\S]*\.drawer \{[^}]*height: 100dvh/);
  });
});

describe("a search with its results beneath", () => {
  let page: HTMLDivElement;
  let root: Root;
  let opened: string[] = [];

  const draw = (value: string, groups: Parameters<typeof SearchMenu>[0]["groups"]) => {
    act(() => {
      root.render(
        createElement(SearchMenu, {
          label: "Page, technician or client",
          value,
          onChange: () => undefined,
          groups,
          none: "Nothing matches.",
          keyHint: "/",
        }),
      );
    });
  };
  const result = (name: string) => ({
    key: name,
    label: name,
    onChoose: () => {
      opened.push(name);
    },
  });

  beforeEach(() => {
    opened = [];
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

  const box = () => page.querySelector<HTMLInputElement>('[role="combobox"]');
  const key = (name: string) => {
    act(() => {
      box()?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
    });
  };

  it("is a combobox named by its label, its panel shut until it takes the keyboard", () => {
    draw("ro", [{ key: "clients", name: "Clients", results: [result("Rohit")] }]);
    expect(box()?.getAttribute("aria-label") ?? page.querySelector("label")?.textContent).toContain("Page");
    expect(box()?.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      box()?.focus();
    });
    expect(box()?.getAttribute("aria-expanded")).toBe("true");
    expect(page.querySelector('[role="listbox"]')?.textContent).toBe("ClientsRohit");
  });

  it("moves through the results with the arrow keys and opens the one moved to with Enter", () => {
    draw("r", [
      { key: "clients", name: "Clients", results: [result("Rohit"), result("Ravi")] },
      { key: "pages", results: [result("Reports")] },
    ]);
    act(() => {
      box()?.focus();
    });
    key("ArrowDown");
    key("ArrowDown");
    const active = box()?.getAttribute("aria-activedescendant") ?? "";
    expect(page.querySelector(`[id="${active}"]`)?.textContent).toBe("Ravi");
    key("Enter");
    expect(opened).toEqual(["Ravi"]);
  });

  it("opens the first with Enter when none is moved to, and shuts on Escape", () => {
    draw("r", [{ key: "clients", name: "Clients", results: [result("Rohit")] }]);
    act(() => {
      box()?.focus();
    });
    key("Escape");
    expect(box()?.getAttribute("aria-expanded")).toBe("false");
    key("Enter");
    expect(opened).toEqual(["Rohit"]);
  });

  it("says so when the words find nothing, and draws no heading for a group without a name", () => {
    draw("zz", [{ key: "pages", results: [] }]);
    act(() => {
      box()?.focus();
    });
    expect(page.textContent).toContain("Nothing matches.");
    draw("re", [{ key: "pages", results: [result("Reports")] }]);
    expect(page.querySelector('[role="group"]')?.hasAttribute("aria-labelledby")).toBe(false);
  });
});

describe("a table row that opens a drawer", () => {
  const opener = () =>
    renderToStaticMarkup(
      createElement(RowOpener, { onOpen: () => undefined, meta: "Kunal Shah · 2 days left", children: "Address" }),
    );

  it("is a button that says it opens a dialog, what it is over its line of detail", () => {
    expect(opener()).toMatch(
      /^<button type="button" class="[^"]+" aria-haspopup="dialog"><span class="[^"]+">Address<\/span><span class="[^"]+">Kunal Shah · 2 days left<\/span><\/button>$/,
    );
  });

  it("reaches over the whole row from its head, as a row's name does", () => {
    expect(css("table.module.css")).toMatch(
      /\.table tbody th\[scope="row"\] :is\(a, button\):first-of-type::after \{\s+position: absolute;\s+inset: 0;/,
    );
  });
});

describe("a filter's count", () => {
  it("follows its words, and is read with them", () => {
    const markup = renderToStaticMarkup(
      createElement(ToggleButton, { pressed: true, asRadio: true, count: 12, children: "Overdue" }),
    );
    expect(markup).toMatch(
      /^<button role="radio" aria-checked="true" type="button" class="[^"]+">Overdue<span class="[^"]+">12<\/span><\/button>$/,
    );
    expect(renderToStaticMarkup(createElement(ToggleButton, { pressed: false, children: "All" }))).not.toContain(
      "<span",
    );
  });

  it("fills the chosen one in ink where asked, and only where asked", () => {
    const edged = classOf(renderToStaticMarkup(createElement(ToggleButton, { pressed: true, children: "All" })));
    const filled = classOf(
      renderToStaticMarkup(createElement(ToggleButton, { pressed: true, filled: true, children: "All" })),
    );
    expect(filled.split(" ")).toHaveLength(edged.split(" ").length + 1);
    expect(css("toggle-button.module.css")).toMatch(
      /\.filled:is\(\[aria-pressed="true"\], \[aria-checked="true"\]\) \{[^}]*background: var\(--ui-strong\)/,
    );
  });
});
