// A page's states (packages/ui): the shape of what is coming, a failure with a
// way to try again, and what stands in for a screen that failed to draw. The
// three apps wrote each of these for themselves (DS-23, FEA-40); now each app
// gives them its own words and look, and the parts that must not differ --
// what a screen reader is told, and that a render error never blanks the
// screen -- are written once. The console's table and tabs are here too.

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "../../packages/ui/ErrorBoundary.tsx";
import { Failed, Loading } from "../../packages/ui/States.tsx";
import { Table } from "../../packages/ui/Table.tsx";
import { Tabs } from "../../packages/ui/Tabs.tsx";

describe("loading", () => {
  const markup = renderToStaticMarkup(createElement(Loading, { label: "Loading" }));

  it("is a status, read out once, and says what is happening in words", () => {
    expect(markup).toMatch(/^<div[^>]* role="status"/);
    expect(markup).toContain(">Loading</span>");
  });

  it("draws the shape of a label and a card while it waits (board B3)", () => {
    expect([...markup.matchAll(/<div/g)]).toHaveLength(3);
  });
});

describe("a failure", () => {
  const markup = renderToStaticMarkup(
    createElement(Failed, { message: "That did not load.", retry: "Try again", onRetry: () => undefined }),
  );

  it("is said at once, with a way to try again", () => {
    expect(markup).toMatch(/^<div[^>]* role="alert"/);
    expect(markup).toContain("That did not load.");
    expect(markup).toMatch(/<button[^>]*>Try again<\/button>/);
  });
});

describe("a screen that failed to draw", () => {
  const fallback = createElement("p", null, "Something went wrong.");
  const child = createElement("p", null, "The screen.");

  it("is drawn as it is while nothing has failed", () => {
    const boundary = new ErrorBoundary({ fallback, children: child });
    expect(boundary.render()).toBe(child);
  });

  it("stands in for the screen once a render throws, rather than leaving it blank", () => {
    const boundary = new ErrorBoundary({ fallback, children: child });
    boundary.state = ErrorBoundary.getDerivedStateFromError();
    expect(boundary.render() as ReactElement).toBe(fallback);
  });
});

describe("the console's table", () => {
  it("is a table with the console's rows, and whatever the caller adds", () => {
    const markup = renderToStaticMarkup(createElement(Table, { className: "mine", children: createElement("tbody") }));
    expect(markup).toMatch(/^<table class="[^"]+ mine">/);
  });
});

describe("the console's tabs", () => {
  it("are a navigation named for what they move between", () => {
    const markup = renderToStaticMarkup(createElement(Tabs, { label: "Client", children: createElement("a") }));
    expect(markup).toMatch(/^<nav[^>]* aria-label="Client"/);
  });
});
