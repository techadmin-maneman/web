// The apps' one button (packages/ui/Button.tsx): every look it has answers a
// press, a pointer resting on it, being unusable and being busy, which no
// button of the three apps did before (DS-22). A busy button says so to a
// screen reader and does not act on a second tap.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, ButtonLink, BUTTON_VARIANTS } from "../../packages/ui/Button.tsx";

const css = readFileSync("packages/ui/button.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The selectors of every rule in the stylesheet, one string each. */
const selectors = [...css.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map((match) => (match[1] ?? "").trim());

describe.each(BUTTON_VARIANTS)("the %s button", (variant) => {
  it("shows it is pressed", () => {
    expect(selectors.some((selector) => selector.includes(`.${variant}:active`))).toBe(true);
  });

  it("shows a pointer resting on it, where there is a pointer to rest", () => {
    expect(css).toMatch(/@media \(hover: hover\)/);
    expect(selectors.some((selector) => selector.includes(`.${variant}:hover`))).toBe(true);
  });

  it("looks unusable when it is", () => {
    expect(selectors.some((selector) => selector.includes(`.${variant}:disabled`))).toBe(true);
  });
});

describe("a busy button", () => {
  it("says it is busy", () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { variant: "primary", size: "action", busy: true }, "Pay"),
    );
    expect(markup).toContain('aria-busy="true"');
  });

  it("looks busy", () => {
    expect(selectors.some((selector) => selector.includes('[aria-busy="true"]'))).toBe(true);
  });

  it("says nothing of it when it is not", () => {
    const markup = renderToStaticMarkup(createElement(Button, { variant: "primary", size: "action" }, "Pay"));
    expect(markup).not.toContain("aria-busy");
  });

  it("does not act on a tap while busy", () => {
    let taps = 0;
    const element = Button({
      variant: "primary",
      size: "action",
      busy: true,
      onClick: () => {
        taps += 1;
      },
      children: "Pay",
    });
    const props = element.props as { onClick?: () => void };
    props.onClick?.();
    expect(taps).toBe(0);
  });
});

describe("a button", () => {
  it("submits nothing unless asked to", () => {
    const markup = renderToStaticMarkup(createElement(Button, { variant: "outline", size: "small" }, "Try again"));
    expect(markup).toContain('type="button"');
  });

  it("can be a link drawn as a button, with the same look", () => {
    const button = renderToStaticMarkup(createElement(Button, { variant: "outline", size: "small" }, "x"));
    const link = renderToStaticMarkup(createElement(ButtonLink, { variant: "outline", size: "small", href: "/" }, "x"));
    const classOf = (markup: string) => /class="([^"]*)"/.exec(markup)?.[1];
    expect(classOf(link)).toBe(classOf(button));
    expect(link).toContain('href="/"');
  });
});
