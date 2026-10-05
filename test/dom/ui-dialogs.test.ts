// The apps' modal parts (packages/ui): a sheet that rises from the foot of the
// column, a dialog that opens a panel over the page, and a panel headed by its
// title and its count. Each is one native <dialog> or <section>, labelled by
// its heading, as every sheet and dialog of the three apps was before, each
// written three times over.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dialog } from "../../packages/ui/Dialog.tsx";
import { Panel } from "../../packages/ui/Panel.tsx";
import { Sheet } from "../../packages/ui/Sheet.tsx";

const css = (name: string) => readFileSync(`packages/ui/${name}`, "utf8");

describe("a sheet", () => {
  const sheet = (props: { rises?: boolean }) =>
    renderToStaticMarkup(
      createElement(Sheet, { labelledBy: "title", ...props, children: createElement("h2", { id: "title" }) }),
    );

  it("is a dialog named by its heading", () => {
    expect(sheet({})).toMatch(/^<dialog[^>]* aria-labelledby="title"/);
  });

  it("rises from the foot unless asked not to, and never for someone who asked for less motion", () => {
    const rising = /class="([^"]*)"/.exec(sheet({}))?.[1] ?? "";
    const still = /class="([^"]*)"/.exec(sheet({ rises: false }))?.[1] ?? "";
    expect(rising.split(" ").length).toBe(still.split(" ").length + 1);
    // The guard is the base stylesheet's, for every animation in the apps.
    expect(css("base.css")).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  });

  it("sits at the foot of the column, over the ink the boards draw behind a sheet", () => {
    expect(css("sheet.module.css")).toMatch(/justify-content: flex-end/);
    expect(css("sheet.module.css")).toMatch(/::backdrop \{\s*background: var\(--ink-night\)/);
  });
});

describe("a dialog", () => {
  const markup = renderToStaticMarkup(
    createElement(Dialog, {
      labelledBy: "drawer",
      className: "panel",
      canClose: true,
      onDismiss: () => undefined,
      children: "x",
    }),
  );

  it("is a dialog named by its heading, which takes the keyboard itself as it opens", () => {
    expect(markup).toMatch(/^<dialog[^>]* aria-labelledby="drawer"/);
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('class="panel"');
  });
});

describe("a panel", () => {
  const markup = renderToStaticMarkup(
    createElement(Panel, {
      titleId: "grievances",
      title: "Grievances",
      count: 3,
      children: createElement("p", null, "x"),
    }),
  );

  it("is a section named by its title", () => {
    expect(markup).toMatch(/^<section[^>]* aria-labelledby="grievances"/);
    expect(markup).toMatch(/<h2[^>]* id="grievances"[^>]*>Grievances<\/h2>/);
  });

  it("says how many it holds beside its title", () => {
    expect(markup).toMatch(/<\/h2><span[^>]*>3<\/span>/);
  });

  it("draws no count when it has none to give", () => {
    const bare = renderToStaticMarkup(createElement(Panel, { titleId: "t", title: "Settings", children: "x" }));
    expect(bare).not.toContain("<span");
  });
});
