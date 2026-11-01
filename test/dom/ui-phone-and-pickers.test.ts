// The console's parts for a phone and its pickers (packages/ui): the navigation's groups, the tab bar at a phone's
// foot, a list's row in place of a table's, the rule a pressing row carries, a picker's choices, and a drawer's
// actions pinned at its foot. What a screen reader is told is held here.

import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Drawer } from "../../packages/ui/Drawer.tsx";
import { ListRow, ListRows } from "../../packages/ui/ListRow.tsx";
import { Popover, PopoverChoice, PopoverHeading } from "../../packages/ui/Popover.tsx";
import { NavGroup, NavItem, SideNav } from "../../packages/ui/SideNav.tsx";
import { TabBar, TabBarItem } from "../../packages/ui/TabBar.tsx";
import { rowRule } from "../../packages/ui/Table.tsx";

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
