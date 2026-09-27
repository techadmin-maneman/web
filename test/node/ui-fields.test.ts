// The apps' fields (packages/ui/Field.tsx): a label, the control, and beneath
// it a hint and, when it is wrong, what is wrong. The three are tied together
// for a screen reader, which every field wired by hand before, each its own
// way, and most without saying which part was the hint and which the error.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox, Field, TextArea, TextInput } from "../../packages/ui/Field.tsx";

const field = (props: { hint?: string; error?: string | null }) =>
  renderToStaticMarkup(
    createElement(Field, {
      label: "Reason",
      ...props,
      children: (control) => createElement(TextArea, { ...control, value: "", onChange: () => undefined }),
    }),
  );

const attribute = (markup: string, element: string, name: string) =>
  new RegExp(`<${element}[^>]* ${name}="([^"]*)"`).exec(markup)?.[1];

describe("a field", () => {
  it("names its control with its label", () => {
    const markup = field({});
    expect(attribute(markup, "label", "for")).toBe(attribute(markup, "textarea", "id"));
  });

  it("describes its control with its hint", () => {
    const markup = field({ hint: "Kept with the decision." });
    const hintId = attribute(markup, "p", "id");
    expect(attribute(markup, "textarea", "aria-describedby")).toBe(hintId);
    expect(markup).not.toContain("aria-invalid");
  });

  it("says what is wrong, beside the hint, and marks the control wrong", () => {
    const markup = field({ hint: "Kept with the decision.", error: "Give a reason." });
    const ids = [...markup.matchAll(/<p[^>]* id="([^"]*)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(attribute(markup, "textarea", "aria-describedby")).toBe(ids.join(" "));
    expect(attribute(markup, "textarea", "aria-invalid")).toBe("true");
  });

  it("gives two fields on one page two names", () => {
    const markup = renderToStaticMarkup(
      createElement("div", null, [
        createElement(Field, { key: 1, label: "A", children: (control) => createElement(TextInput, control) }),
        createElement(Field, { key: 2, label: "B", children: (control) => createElement(TextInput, control) }),
      ]),
    );
    const ids = [...markup.matchAll(/<input[^>]* id="([^"]*)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("a checkbox", () => {
  const markup = renderToStaticMarkup(
    createElement(Checkbox, { label: "I have checked", checked: false, onChange: () => undefined }),
  );

  it("is a native box, named by the words beside it", () => {
    expect(markup).toContain('type="checkbox"');
    expect(attribute(markup, "label", "for")).toBe(attribute(markup, "input", "id"));
  });
});

describe("the fields' look", () => {
  const css = readFileSync("packages/ui/field.module.css", "utf8");

  it("edges a field at 3:1 against paper and white, as ADR 0025 item 36 rules for every field", () => {
    expect(css).toMatch(/border: var\(--hairline\) solid var\(--paper-control\)/);
    expect(css).not.toContain("--paper-line");
  });

  it("draws its focus ring inside the box, where a panel's edge cannot cut it", () => {
    expect(css).toMatch(/outline-offset: calc\(-1 \* var\(--focus-width\)\)/);
  });
});
